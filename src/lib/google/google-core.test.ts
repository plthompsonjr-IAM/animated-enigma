import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  GOOGLE_SCOPES,
  SCOPE_LABELS,
  GOOGLE_AUTH_ENDPOINT,
  isGoogleScope,
  grantedScopes,
  hasScope,
  providerStatus,
  buildAuthUrl,
  newState,
  statesMatch,
  parseEncryptionKey,
  encryptToken,
  decryptToken,
  connectionSummary,
} from './google-core';

const KEY_B64 = randomBytes(32).toString('base64');
const KEY = parseEncryptionKey(KEY_B64)!;

const fullEnv = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  redirectUri: 'https://foreman.example.com/api/auth/google/callback',
  encryptionKey: KEY_B64,
};

describe('scopes', () => {
  it('asks for exactly two scopes, and neither reads the inbox', () => {
    expect(GOOGLE_SCOPES).toHaveLength(2);
    expect(GOOGLE_SCOPES).toContain('https://www.googleapis.com/auth/gmail.send');
    expect(GOOGLE_SCOPES).toContain('https://www.googleapis.com/auth/calendar.events');
    expect(GOOGLE_SCOPES.some((s) => s.includes('readonly') || s.endsWith('/gmail.readonly'))).toBe(false);
    expect(GOOGLE_SCOPES.some((s) => s.endsWith('/calendar'))).toBe(false);
  });

  it('has a plain-English label for every scope', () => {
    for (const s of GOOGLE_SCOPES) expect(SCOPE_LABELS[s].length).toBeGreaterThan(5);
  });

  it('recognises only the scopes it asked for', () => {
    expect(isGoogleScope('https://www.googleapis.com/auth/gmail.send')).toBe(true);
    expect(isGoogleScope('https://www.googleapis.com/auth/gmail.readonly')).toBe(false);
    expect(isGoogleScope('')).toBe(false);
  });

  it('keeps only requested scopes from what Google reports, in declared order', () => {
    const granted = grantedScopes(
      'openid email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/drive',
    );
    expect(granted).toEqual([
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/calendar.events',
    ]);
  });

  it('handles a user who unticked one scope on the consent screen', () => {
    const granted = grantedScopes('openid https://www.googleapis.com/auth/gmail.send');
    expect(hasScope(granted, 'https://www.googleapis.com/auth/gmail.send')).toBe(true);
    expect(hasScope(granted, 'https://www.googleapis.com/auth/calendar.events')).toBe(false);
  });

  it('returns nothing for empty or absent input', () => {
    expect(grantedScopes('')).toEqual([]);
    expect(grantedScopes(null)).toEqual([]);
    expect(grantedScopes(undefined)).toEqual([]);
  });
});

describe('providerStatus', () => {
  it('is configured when every variable is present and the key is valid', () => {
    const s = providerStatus(fullEnv);
    expect(s.configured).toBe(true);
    expect(s.missing).toEqual([]);
    expect(s.message).toContain('never to read your inbox');
  });

  it('names each missing variable so the fix is obvious', () => {
    const s = providerStatus({ ...fullEnv, clientSecret: '', redirectUri: null });
    expect(s.configured).toBe(false);
    expect(s.missing).toEqual(['GOOGLE_CLIENT_SECRET', 'GOOGLE_OAUTH_REDIRECT_URI']);
    expect(s.message).toContain('GOOGLE_CLIENT_SECRET');
    expect(s.message).toContain('Nothing sends or syncs');
  });

  it('treats a malformed encryption key as missing, not as present', () => {
    const s = providerStatus({ ...fullEnv, encryptionKey: 'too-short' });
    expect(s.configured).toBe(false);
    expect(s.missing).toEqual(['GOOGLE_TOKEN_ENCRYPTION_KEY']);
  });

  it('treats whitespace as absent', () => {
    expect(providerStatus({ ...fullEnv, clientId: '   ' }).missing).toEqual(['GOOGLE_CLIENT_ID']);
  });

  it('lists everything when nothing is set', () => {
    expect(providerStatus({}).missing).toHaveLength(4);
  });
});

describe('buildAuthUrl', () => {
  const url = new URL(
    buildAuthUrl({ clientId: 'cid', redirectUri: fullEnv.redirectUri, state: 'st-123' }),
  );

  it('points at the Google consent endpoint', () => {
    expect(`${url.origin}${url.pathname}`).toBe(GOOGLE_AUTH_ENDPOINT);
  });

  it('carries the identifiers and the state', () => {
    expect(url.searchParams.get('client_id')).toBe('cid');
    expect(url.searchParams.get('redirect_uri')).toBe(fullEnv.redirectUri);
    expect(url.searchParams.get('state')).toBe('st-123');
    expect(url.searchParams.get('response_type')).toBe('code');
  });

  it('asks for a refresh token — offline access with forced consent', () => {
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('include_granted_scopes')).toBe('true');
  });

  it('requests both scopes plus openid and email, space-separated', () => {
    const scope = url.searchParams.get('scope')!.split(' ');
    expect(scope).toContain('https://www.googleapis.com/auth/gmail.send');
    expect(scope).toContain('https://www.googleapis.com/auth/calendar.events');
    expect(scope).toContain('openid');
    expect(scope).toContain('email');
    expect(scope).not.toContain('https://www.googleapis.com/auth/gmail.readonly');
  });

  it('can be narrowed to a subset of scopes', () => {
    const u = new URL(
      buildAuthUrl({
        clientId: 'cid',
        redirectUri: fullEnv.redirectUri,
        state: 's',
        scopes: ['https://www.googleapis.com/auth/gmail.send'],
      }),
    );
    expect(u.searchParams.get('scope')).not.toContain('calendar.events');
  });
});

describe('state', () => {
  it('is long, URL-safe, and different every time', () => {
    const a = newState();
    const b = newState();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('matches only itself', () => {
    const s = newState();
    expect(statesMatch(s, s)).toBe(true);
    expect(statesMatch(s, newState())).toBe(false);
  });

  it('rejects empty, missing, and length-mismatched values without throwing', () => {
    expect(statesMatch('', '')).toBe(false);
    expect(statesMatch(null, 'x')).toBe(false);
    expect(statesMatch('x', undefined)).toBe(false);
    expect(statesMatch('abc', 'abcd')).toBe(false);
  });
});

describe('encryption key', () => {
  it('accepts exactly 32 base64 bytes', () => {
    expect(parseEncryptionKey(KEY_B64)?.length).toBe(32);
  });

  it('refuses the wrong length rather than padding it into shape', () => {
    expect(parseEncryptionKey(randomBytes(16).toString('base64'))).toBeNull();
    expect(parseEncryptionKey(randomBytes(64).toString('base64'))).toBeNull();
  });

  it('refuses garbage, empty, and absent', () => {
    expect(parseEncryptionKey('not base64 at all!!')).toBeNull();
    expect(parseEncryptionKey('')).toBeNull();
    expect(parseEncryptionKey('   ')).toBeNull();
    expect(parseEncryptionKey(null)).toBeNull();
    expect(parseEncryptionKey(undefined)).toBeNull();
  });

  it('tolerates surrounding whitespace from a copy-paste', () => {
    expect(parseEncryptionKey(`  ${KEY_B64}\n`)?.length).toBe(32);
  });
});

describe('token encryption', () => {
  const token = '1//0gK9-example-refresh-token_with.symbols';

  it('round-trips', () => {
    expect(decryptToken(encryptToken(token, KEY), KEY)).toBe(token);
  });

  it('round-trips unicode and the empty string', () => {
    expect(decryptToken(encryptToken('héllo — 日本', KEY), KEY)).toBe('héllo — 日本');
    expect(decryptToken(encryptToken('', KEY), KEY)).toBe('');
  });

  it('never produces the same ciphertext twice for the same token', () => {
    expect(encryptToken(token, KEY)).not.toBe(encryptToken(token, KEY));
  });

  it('is versioned and URL-safe', () => {
    const c = encryptToken(token, KEY);
    expect(c.startsWith('v1.')).toBe(true);
    expect(c.split('.')).toHaveLength(4);
    expect(c).toMatch(/^[A-Za-z0-9_.-]+$/);
  });

  it('returns null, not garbage, under the wrong key', () => {
    const other = parseEncryptionKey(randomBytes(32).toString('base64'))!;
    expect(decryptToken(encryptToken(token, KEY), other)).toBeNull();
  });

  it('detects tampering in any segment', () => {
    const c = encryptToken(token, KEY);
    const parts = c.split('.');
    for (const i of [1, 2, 3]) {
      const mutated = [...parts];
      const seg = mutated[i]!;
      // Flip one character to something different.
      mutated[i] = (seg[0] === 'A' ? 'B' : 'A') + seg.slice(1);
      expect(decryptToken(mutated.join('.'), KEY)).toBeNull();
    }
  });

  it('rejects the wrong format version and malformed strings', () => {
    const c = encryptToken(token, KEY);
    expect(decryptToken(c.replace(/^v1\./, 'v0.'), KEY)).toBeNull();
    expect(decryptToken('v1.only.three', KEY)).toBeNull();
    expect(decryptToken('', KEY)).toBeNull();
    expect(decryptToken(null, KEY)).toBeNull();
    expect(decryptToken('plainly not encrypted', KEY)).toBeNull();
  });
});

describe('connectionSummary', () => {
  it('summarises a full connection for the settings card', () => {
    const s = connectionSummary({
      googleEmail: 'pat@example.com',
      scopes: [...GOOGLE_SCOPES],
      connectedAt: new Date('2026-09-09T14:00:00Z'),
      revokedAt: null,
    });
    expect(s.email).toBe('pat@example.com');
    expect(s.grants).toEqual(['Send email as you', 'Add and update calendar events']);
    expect(s.canSendEmail).toBe(true);
    expect(s.canSyncCalendar).toBe(true);
    expect(s.connectedOn).toBe('2026-09-09');
    expect(s.live).toBe(true);
  });

  it('reports a partial grant honestly', () => {
    const s = connectionSummary({
      googleEmail: 'pat@example.com',
      scopes: ['https://www.googleapis.com/auth/calendar.events'],
      connectedAt: '2026-09-09T14:00:00Z',
    });
    expect(s.canSendEmail).toBe(false);
    expect(s.canSyncCalendar).toBe(true);
    expect(s.grants).toEqual(['Add and update calendar events']);
  });

  it('marks a revoked connection as not live', () => {
    const s = connectionSummary({
      googleEmail: 'pat@example.com',
      scopes: [...GOOGLE_SCOPES],
      connectedAt: '2026-09-09T14:00:00Z',
      revokedAt: '2026-09-10T00:00:00Z',
    });
    expect(s.live).toBe(false);
  });

  it('ignores scopes it never asked for', () => {
    const s = connectionSummary({
      googleEmail: 'x@y.z',
      scopes: ['https://www.googleapis.com/auth/drive', 'openid'],
      connectedAt: '2026-09-09T00:00:00Z',
    });
    expect(s.grants).toEqual([]);
    expect(s.canSendEmail).toBe(false);
  });
});
