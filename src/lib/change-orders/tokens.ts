import { createHash, randomBytes } from 'node:crypto';

/**
 * Secure share-link tokens for client change-order approval (same scheme as
 * proposals): only the SHA-256 hash is stored, so a database leak cannot be
 * turned into working approval links. The raw token exists solely in the URL.
 */

export function generateChangeOrderToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashChangeOrderToken(token) };
}

export function hashChangeOrderToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
