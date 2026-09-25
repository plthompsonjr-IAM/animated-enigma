/**
 * Google Workspace connection (Task 31): the pure parts of OAuth and token
 * custody.
 *
 * Two decisions shape this module.
 *
 * **Least privilege on the consent screen.** Only `gmail.send` and
 * `calendar.events`. Not `gmail.readonly`, not the full `calendar` scope. A
 * contractor connecting their business account should read "send email on your
 * behalf" and "manage calendar events" — and nothing that opens their inbox. The
 * scopes are the entire permission story, so they are the first thing here.
 *
 * **The refresh token never touches the database in the clear.** A Google
 * refresh token is a long-lived credential: whoever holds it can send mail as
 * the owner until it is revoked. It is encrypted app-side, with a key that
 * lives only in the host's environment, so a database dump, a leaked backup, or
 * a misconfigured policy yields ciphertext. Postgres never sees the plaintext.
 *
 * Pure. Node's `crypto` only — no network, no database.
 */

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

// ── Scopes ───────────────────────────────────────────────────────────────────

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar.events',
] as const;
export type GoogleScope = (typeof GOOGLE_SCOPES)[number];

/** What each scope means, in the words the settings card shows. */
export const SCOPE_LABELS: Record<GoogleScope, string> = {
  'https://www.googleapis.com/auth/gmail.send': 'Send email as you',
  'https://www.googleapis.com/auth/calendar.events': 'Add and update calendar events',
};

export function isGoogleScope(value: string): value is GoogleScope {
  return (GOOGLE_SCOPES as readonly string[]).includes(value);
}

/**
 * Google returns the scopes it actually granted as a space-separated string,
 * and a user can untick one on the consent screen. Keep only the ones we asked
 * for, so a stray scope can never be recorded as held.
 */
export function grantedScopes(scopeString: string | null | undefined): GoogleScope[] {
  if (!scopeString) return [];
  const seen = new Set<GoogleScope>();
  for (const s of scopeString.split(/\s+/)) {
    if (isGoogleScope(s)) seen.add(s);
  }
  return GOOGLE_SCOPES.filter((s) => seen.has(s));
}

export function hasScope(granted: readonly string[], wanted: GoogleScope): boolean {
  return granted.includes(wanted);
}

// ── Provider status ──────────────────────────────────────────────────────────

export interface GoogleEnv {
  clientId?: string | null;
  clientSecret?: string | null;
  redirectUri?: string | null;
  encryptionKey?: string | null;
}

export interface ProviderStatus {
  configured: boolean;
  /** Which variables are absent, by name — so the fix is obvious. */
  missing: string[];
  /** One sentence for the screen. */
  message: string;
}

/**
 * Whether Google can be connected at all.
 *
 * Mirrors the AI Foreman's rule: a screen that quietly does nothing is worse
 * than one that says what is missing. Names the variables, because "not
 * configured" sends someone hunting and a name sends them to the right line.
 */
export function providerStatus(env: GoogleEnv): ProviderStatus {
  const missing: string[] = [];
  if (!env.clientId?.trim()) missing.push('GOOGLE_CLIENT_ID');
  if (!env.clientSecret?.trim()) missing.push('GOOGLE_CLIENT_SECRET');
  if (!env.redirectUri?.trim()) missing.push('GOOGLE_OAUTH_REDIRECT_URI');
  if (!parseEncryptionKey(env.encryptionKey)) missing.push('GOOGLE_TOKEN_ENCRYPTION_KEY');

  if (missing.length === 0) {
    return {
      configured: true,
      missing,
      message:
        'Google is set up. Connecting an account asks only to send email as you and manage calendar events — never to read your inbox.',
    };
  }
  return {
    configured: false,
    missing,
    message: `Google isn't connected yet. Missing: ${missing.join(', ')}. Nothing sends or syncs until these are set.`,
  };
}

// ── Authorization URL ────────────────────────────────────────────────────────

export const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
export const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
export const GOOGLE_USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';

/**
 * The consent-screen URL.
 *
 * `access_type=offline` plus `prompt=consent` is what makes Google issue a
 * refresh token — without both, a returning user gets only a one-hour access
 * token and the connection silently expires. `include_granted_scopes` lets a
 * later, wider request build on this one instead of replacing it.
 */
export function buildAuthUrl(args: {
  clientId: string;
  redirectUri: string;
  state: string;
  scopes?: readonly GoogleScope[];
}): string {
  const scopes = args.scopes ?? GOOGLE_SCOPES;
  const params = new URLSearchParams({
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    response_type: 'code',
    scope: [...scopes, 'openid', 'email'].join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: args.state,
  });
  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
}

// ── CSRF state ───────────────────────────────────────────────────────────────

/** Random, URL-safe, and long enough that guessing it is not a strategy. */
export function newState(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Constant-time comparison. A plain `===` leaks, through timing, how many
 * leading characters matched — which is exactly the hint an attacker wants.
 * Anything empty or mismatched in length is simply false.
 */
export function statesMatch(expected: string | null | undefined, received: string | null | undefined): boolean {
  if (!expected || !received) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ── Token encryption ─────────────────────────────────────────────────────────

const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // GCM standard nonce
const FORMAT = 'v1';

/**
 * The key must be exactly 32 bytes, supplied as base64. Anything else is
 * refused rather than padded or hashed into shape — a key that "works" by
 * accident is a key nobody can rotate on purpose.
 */
export function parseEncryptionKey(raw: string | null | undefined): Buffer | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let buf: Buffer;
  try {
    buf = Buffer.from(trimmed, 'base64');
  } catch {
    return null;
  }
  // Buffer.from is lenient with garbage; the length check is what actually
  // validates. A 32-byte key base64-encodes to 44 characters.
  if (buf.length !== KEY_BYTES) return null;
  if (buf.toString('base64').replace(/=+$/, '') !== trimmed.replace(/=+$/, '')) return null;
  return buf;
}

/**
 * `v1.<iv>.<tag>.<ciphertext>`, each part base64url. A fresh IV every call, so
 * encrypting the same token twice yields different strings and nothing about
 * the plaintext is inferable from the stored value.
 */
export function encryptToken(plain: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [FORMAT, b64u(iv), b64u(tag), b64u(body)].join('.');
}

/**
 * Returns null on anything wrong — bad format, wrong key, tampered bytes —
 * rather than throwing. The caller treats null as "this connection is broken;
 * ask the user to reconnect", which is the right answer in every one of those
 * cases and never worth distinguishing at the call site.
 */
export function decryptToken(stored: string | null | undefined, key: Buffer): string | null {
  if (!stored) return null;
  const parts = stored.split('.');
  if (parts.length !== 4 || parts[0] !== FORMAT) return null;
  try {
    const iv = Buffer.from(parts[1]!, 'base64url');
    const tag = Buffer.from(parts[2]!, 'base64url');
    const body = Buffer.from(parts[3]!, 'base64url');
    if (iv.length !== IV_BYTES || tag.length !== 16) return null;
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

function b64u(buf: Buffer): string {
  return buf.toString('base64url');
}

// ── Connection summary ───────────────────────────────────────────────────────

export interface ConnectionRow {
  googleEmail: string;
  scopes: readonly string[];
  connectedAt: Date | string;
  revokedAt?: Date | string | null;
}

export interface ConnectionSummary {
  email: string;
  /** Human labels for what was actually granted, in the declared order. */
  grants: string[];
  /** Which of the two features this connection can drive. */
  canSendEmail: boolean;
  canSyncCalendar: boolean;
  /** Calendar day the connection was made, ISO `YYYY-MM-DD`. */
  connectedOn: string;
  live: boolean;
}

/** What the settings card says about a connection. */
export function connectionSummary(row: ConnectionRow): ConnectionSummary {
  const granted = grantedScopes(row.scopes.join(' '));
  const connected = row.connectedAt instanceof Date ? row.connectedAt : new Date(row.connectedAt);
  return {
    email: row.googleEmail,
    grants: granted.map((s) => SCOPE_LABELS[s]),
    canSendEmail: hasScope(granted, 'https://www.googleapis.com/auth/gmail.send'),
    canSyncCalendar: hasScope(granted, 'https://www.googleapis.com/auth/calendar.events'),
    connectedOn: connected.toISOString().slice(0, 10),
    live: !row.revokedAt,
  };
}
