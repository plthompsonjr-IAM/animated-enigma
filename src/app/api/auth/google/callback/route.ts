import { NextResponse, type NextRequest } from 'next/server';
import { getDb, schema } from '@/db';
import { getAuthContext } from '@/lib/auth/session';
import { logger } from '@/lib/logger';
import {
  GOOGLE_TOKEN_ENDPOINT,
  GOOGLE_USERINFO_ENDPOINT,
  encryptToken,
  grantedScopes,
  parseEncryptionKey,
  statesMatch,
} from '@/lib/google/google-core';
import { GOOGLE_STATE_COOKIE, googleEnv } from '@/lib/google/tokens';

/**
 * Google sends the browser back here with a `code`. Exchange it, learn which
 * account consented and to what, encrypt the refresh token, and store it
 * against the signed-in member.
 *
 * Every exit is a redirect to Settings with a one-word reason the card turns
 * into a sentence. Nothing about the code, the tokens, or the response bodies
 * is ever logged — the log lines below carry only what went wrong.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const origin = url.origin;
  const back = (reason: string) => {
    const res = NextResponse.redirect(new URL(`/settings?google=${reason}`, origin));
    res.cookies.set({ name: GOOGLE_STATE_COOKIE, value: '', path: '/api/auth/google', maxAge: 0 });
    return res;
  };

  // The person clicked "Cancel" on Google's screen.
  if (url.searchParams.get('error')) return back('denied');

  const ctx = await getAuthContext();
  if (!ctx.userId) return NextResponse.redirect(new URL('/login?next=/settings', origin));
  if (!ctx.dbAvailable || !ctx.activeOrg) return back('failed');

  // CSRF: the state we set before leaving must be the one Google echoed back.
  const expected = request.cookies.get(GOOGLE_STATE_COOKIE)?.value;
  if (!statesMatch(expected, url.searchParams.get('state'))) {
    logger.warn('google: oauth state mismatch', { userId: ctx.userId });
    return back('state');
  }

  const code = url.searchParams.get('code');
  if (!code) return back('failed');

  const env = googleEnv();
  const key = parseEncryptionKey(env.encryptionKey);
  if (!env.clientId || !env.clientSecret || !env.redirectUri || !key) return back('unconfigured');

  // Exchange the code for tokens.
  let token: { access_token?: string; refresh_token?: string; scope?: string };
  try {
    const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env.clientId,
        client_secret: env.clientSecret,
        redirect_uri: env.redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      logger.warn('google: code exchange rejected', { status: res.status, error: body.error });
      return back('failed');
    }
    token = (await res.json()) as typeof token;
  } catch (error) {
    logger.warn('google: code exchange failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return back('failed');
  }

  // Without a refresh token there is nothing durable to store. We ask for one
  // with prompt=consent; if Google still withholds it, the honest answer is to
  // say so rather than store an access token that dies in an hour.
  if (!token.refresh_token) return back('norefresh');
  if (!token.access_token) return back('failed');

  const scopes = grantedScopes(token.scope);
  if (scopes.length === 0) return back('noscopes');

  // Which account actually consented. It may not be the app login email.
  let googleEmail: string | null = null;
  try {
    const res = await fetch(GOOGLE_USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    if (res.ok) {
      const info = (await res.json()) as { email?: string };
      googleEmail = info.email?.trim().toLowerCase() || null;
    }
  } catch {
    // Handled by the null check below.
  }
  if (!googleEmail) return back('noemail');

  const ciphertext = encryptToken(token.refresh_token, key);
  const now = new Date();

  try {
    await getDb()
      .insert(schema.googleConnections)
      .values({
        organizationId: ctx.activeOrg.organizationId,
        userId: ctx.userId,
        googleEmail,
        scopes,
        refreshTokenCiphertext: ciphertext,
        connectedAt: now,
        revokedAt: null,
      })
      .onConflictDoUpdate({
        target: [schema.googleConnections.organizationId, schema.googleConnections.userId],
        set: {
          googleEmail,
          scopes,
          refreshTokenCiphertext: ciphertext,
          connectedAt: now,
          revokedAt: null,
        },
      });
  } catch (error) {
    logger.error('google: storing connection failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return back('failed');
  }

  return back('connected');
}
