import { cache } from 'react';
import { cookies } from 'next/headers';
import { eq, and } from 'drizzle-orm';
import { createClient } from '@/lib/supabase/server';
import { publicEnv } from '@/lib/env';
import { getDb, schema } from '@/db';
import { logger } from '@/lib/logger';
import type { Role } from './rbac';

export const ACTIVE_ORG_COOKIE = 'tf-active-org';

export interface Membership {
  organizationId: string;
  organizationName: string;
  roles: Role[];
  extraPermissions: string[];
}

export interface AuthContext {
  /** Supabase is configured — auth is enforceable. */
  configured: boolean;
  /** Database reachable (memberships resolvable). */
  dbAvailable: boolean;
  userId: string | null;
  email: string | null;
  memberships: Membership[];
  /** The active organization (cookie-selected, validated against memberships). */
  activeOrg: Membership | null;
}

const EMPTY: AuthContext = {
  configured: false,
  dbAvailable: false,
  userId: null,
  email: null,
  memberships: [],
  activeOrg: null,
};

/**
 * Resolve the caller's auth context: Supabase user → app user row → org
 * memberships with roles → active organization. Cached per request.
 *
 * Degrades explicitly: without Supabase env the app runs in unauthenticated
 * preview mode (early development); without DATABASE_URL the user is
 * authenticated but memberships cannot resolve.
 */
export const getAuthContext = cache(async (): Promise<AuthContext> => {
  if (!publicEnv.supabaseUrl || !publicEnv.supabaseAnonKey) return EMPTY;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ...EMPTY, configured: true };

  if (!process.env.DATABASE_URL) {
    return {
      configured: true,
      dbAvailable: false,
      userId: user.id,
      email: user.email ?? null,
      memberships: [],
      activeOrg: null,
    };
  }

  try {
    const db = getDb();

    // Ensure the app profile row mirrors the auth user (idempotent).
    await db
      .insert(schema.users)
      .values({ id: user.id, email: user.email ?? `${user.id}@unknown.local` })
      .onConflictDoNothing({ target: schema.users.id });

    const rows = await db
      .select({
        organizationId: schema.organizationMembers.organizationId,
        organizationName: schema.organizations.name,
        roles: schema.organizationMembers.roles,
        extraPermissions: schema.organizationMembers.extraPermissions,
      })
      .from(schema.organizationMembers)
      .innerJoin(
        schema.organizations,
        eq(schema.organizations.id, schema.organizationMembers.organizationId),
      )
      .where(
        and(
          eq(schema.organizationMembers.userId, user.id),
          eq(schema.organizationMembers.isActive, true),
        ),
      );

    const memberships: Membership[] = rows.map((r) => ({
      organizationId: r.organizationId,
      organizationName: r.organizationName,
      roles: (r.roles ?? []) as Role[],
      extraPermissions: r.extraPermissions ?? [],
    }));

    const cookieStore = await cookies();
    const requested = cookieStore.get(ACTIVE_ORG_COOKIE)?.value;
    const activeOrg =
      memberships.find((m) => m.organizationId === requested) ?? memberships[0] ?? null;

    return {
      configured: true,
      dbAvailable: true,
      userId: user.id,
      email: user.email ?? null,
      memberships,
      activeOrg,
    };
  } catch (error) {
    logger.error('auth-context: database unavailable', {
      message: error instanceof Error ? error.message : String(error),
    });
    return {
      configured: true,
      dbAvailable: false,
      userId: user.id,
      email: user.email ?? null,
      memberships: [],
      activeOrg: null,
    };
  }
});
