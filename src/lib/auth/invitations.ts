import { createHash, randomBytes } from 'node:crypto';

/**
 * Invitation tokens.
 *
 * The raw token appears only in the invite URL sent to the invitee; the
 * database stores its SHA-256 hash. Possession of the raw token (plus matching
 * email at acceptance) is the credential.
 */

export const INVITATION_TTL_DAYS = 7;

export function generateInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashInviteToken(token) };
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function invitationExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export function isInvitationExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}
