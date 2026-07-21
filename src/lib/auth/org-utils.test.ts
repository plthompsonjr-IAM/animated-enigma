import { describe, it, expect } from 'vitest';
import { slugify, wouldRemoveLastOwner, type MemberRoles } from './org-utils';
import {
  generateInviteToken,
  hashInviteToken,
  invitationExpiry,
  isInvitationExpired,
} from './invitations';

describe('slugify', () => {
  it('produces a url-safe slug with a suffix', () => {
    expect(slugify("PT's Tactical Renovations", 'abc123')).toBe('pts-tactical-renovations-abc123');
  });

  it('falls back for names with no usable characters', () => {
    expect(slugify('!!!', 'xyz')).toBe('org-xyz');
  });
});

describe('wouldRemoveLastOwner', () => {
  const members: MemberRoles[] = [
    { memberId: 'm1', roles: ['owner'], isActive: true },
    { memberId: 'm2', roles: ['office_manager'], isActive: true },
    { memberId: 'm3', roles: ['owner'], isActive: false }, // inactive owner doesn't count
  ];

  it('blocks demoting the only active administrator', () => {
    expect(wouldRemoveLastOwner(members, 'm1', ['office_manager'])).toBe(true);
  });

  it('allows demotion when another active administrator exists', () => {
    const withSecondOwner = [
      ...members,
      { memberId: 'm4', roles: ['owner'] as MemberRoles['roles'], isActive: true },
    ];
    expect(wouldRemoveLastOwner(withSecondOwner, 'm1', ['technician'])).toBe(false);
  });

  it('allows changes that keep the owner role', () => {
    expect(wouldRemoveLastOwner(members, 'm1', ['owner', 'estimator'])).toBe(false);
  });

  it('ignores non-owner members', () => {
    expect(wouldRemoveLastOwner(members, 'm2', ['technician'])).toBe(false);
  });
});

describe('invitation tokens', () => {
  it('hash of the generated token matches the stored hash', () => {
    const { token, tokenHash } = generateInviteToken();
    expect(hashInviteToken(token)).toBe(tokenHash);
  });

  it('tokens are unique and long enough', () => {
    const a = generateInviteToken();
    const b = generateInviteToken();
    expect(a.token).not.toBe(b.token);
    expect(a.token.length).toBeGreaterThanOrEqual(40);
  });

  it('expiry is 7 days out and expiration check works', () => {
    const from = new Date('2026-07-01T00:00:00Z');
    const expires = invitationExpiry(from);
    expect(expires.toISOString()).toBe('2026-07-08T00:00:00.000Z');
    expect(isInvitationExpired(expires, new Date('2026-07-07T23:59:59Z'))).toBe(false);
    expect(isInvitationExpired(expires, new Date('2026-07-08T00:00:01Z'))).toBe(true);
  });
});
