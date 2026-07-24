import { createHash, randomBytes } from 'node:crypto';

/**
 * Proposal share-link tokens. The raw token appears only in the secure link
 * given to the client; the database stores its SHA-256 hash. Possession of the
 * raw token is what grants read + accept/decline on the public view.
 */

export function generateProposalToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashProposalToken(token) };
}

export function hashProposalToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
