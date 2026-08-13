import type { Role } from './rbac';

/** URL-safe slug from an organization name, with a random suffix for uniqueness. */
export function slugify(name: string, suffix: string = randomSuffix()): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s-]+/g, '-')
    .slice(0, 40)
    .replace(/^-+|-+$/g, '');
  return `${base || 'org'}-${suffix}`;
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

export interface MemberRoles {
  memberId: string;
  roles: readonly Role[];
  isActive: boolean;
}

/**
 * Guard against locking an organization out of administration: a role change
 * or deactivation must leave at least one other active member holding `owner`.
 */
export function wouldRemoveLastOwner(
  members: readonly MemberRoles[],
  targetMemberId: string,
  nextRoles: readonly Role[],
): boolean {
  const target = members.find((m) => m.memberId === targetMemberId);
  if (!target || !target.isActive || !target.roles.includes('owner')) return false;
  if (nextRoles.includes('owner')) return false;
  const otherOwners = members.filter(
    (m) => m.memberId !== targetMemberId && m.isActive && m.roles.includes('owner'),
  );
  return otherOwners.length === 0;
}
