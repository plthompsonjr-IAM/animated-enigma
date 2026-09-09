import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { serverEnv } from '@/lib/env';
import { logger } from '@/lib/logger';
import {
  GOOGLE_REVOKE_ENDPOINT,
  GOOGLE_TOKEN_ENDPOINT,
  decryptToken,
  parseEncryptionKey,
  type GoogleEnv,
  type GoogleScope,
} from './google-core';
import { ownLiveConnection } from './queries';

/** The httpOnly cookie carrying the OAuth CSRF state across the Google round trip. */
export const GOOGLE_STATE_COOKIE = 'tf-google-state';

/** The Google-relevant slice of the server environment, in the core's shape. */
export function googleEnv(): GoogleEnv {
  const env = serverEnv();
  return {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: env.GOOGLE_OAUTH_REDIRECT_URI,
    encryptionKey: env.GOOGLE_TOKEN_ENCRYPTION_KEY,
  };
}

export interface AccessGrant {
  accessToken: string;
  googleEmail: string;
  scopes: GoogleScope[];
}

/**
 * A short-lived access token for the caller's own Google account, or null.
 *
 * Null covers every reason nothing can be sent — no connection, revoked,
 * environment missing, ciphertext unreadable, Google refusing the refresh —
 * because at every call site the right response is identical: fall back to the
 * copy-link path and tell the person to reconnect. The distinctions are logged
 * here, where someone debugging can see them, not surfaced where they'd only be
 * noise.
 *
 * The access token is never persisted. It lives for an hour; the refresh token
 * that mints it is the thing worth protecting, and it never leaves this module
 * decrypted.
 */
export async function accessTokenFor(
  organizationId: string,
  userId: string,
): Promise<AccessGrant | null> {
  const env = googleEnv();
  const key = parseEncryptionKey(env.encryptionKey);
  if (!env.clientId || !env.clientSecret || !key) return null;

  const row = await ownLiveConnection(organizationId, userId);
  if (!row) return null;

  const refreshToken = decryptToken(row.refreshTokenCiphertext, key);
  if (!refreshToken) {
    // Wrong key (rotated?) or corrupted row. The connection is unusable; say so
    // once in the log and let the caller fall back.
    logger.warn('google: stored refresh token could not be decrypted', {
      organizationId,
      userId,
    });
    return null;
  }

  let response: Response;
  try {
    response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: env.clientId,
        client_secret: env.clientSecret,
      }),
    });
  } catch (error) {
    logger.warn('google: token refresh request failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    // `invalid_grant` means the user revoked access from their Google account.
    // Record that so the settings card stops claiming a connection that isn't.
    if (body.error === 'invalid_grant') {
      await getDb()
        .update(schema.googleConnections)
        .set({ revokedAt: new Date() })
        .where(eq(schema.googleConnections.id, row.id));
      logger.warn('google: refresh token no longer valid; connection marked revoked', {
        organizationId,
        userId,
      });
    } else {
      logger.warn('google: token refresh rejected', { status: response.status, error: body.error });
    }
    return null;
  }

  const json = (await response.json()) as { access_token?: string };
  if (!json.access_token) return null;

  return {
    accessToken: json.access_token,
    googleEmail: row.googleEmail,
    scopes: row.scopes as GoogleScope[],
  };
}

/**
 * Revoke at Google and mark the row. Google's revoke is best-effort: if it
 * fails (already revoked, network), the local row is still marked, because
 * the person asked to disconnect and the app must stop using the token
 * regardless of what Google's side says.
 */
export async function revokeConnection(organizationId: string, userId: string): Promise<boolean> {
  const env = googleEnv();
  const key = parseEncryptionKey(env.encryptionKey);
  const row = await ownLiveConnection(organizationId, userId);
  if (!row) return false;

  const refreshToken = key ? decryptToken(row.refreshTokenCiphertext, key) : null;
  if (refreshToken) {
    try {
      await fetch(GOOGLE_REVOKE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: refreshToken }),
      });
    } catch (error) {
      logger.warn('google: revoke request failed; marking revoked locally anyway', {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await getDb()
    .update(schema.googleConnections)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.googleConnections.id, row.id),
        eq(schema.googleConnections.userId, userId),
      ),
    );
  return true;
}
