import { pgTable, pgEnum, uuid, text, timestamp, boolean, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * Database schema — auth & tenancy foundation.
 *
 * The complete relational design lives in `docs/database-schema.md`; tables are
 * translated here domain by domain as each task lands. This module covers the
 * identity/tenancy domain (Task 6): organizations, users, memberships with
 * roles, and invitations. RLS policies and triggers ship in the SQL migrations
 * alongside the generated DDL.
 */

export const userRoleEnum = pgEnum('user_role', [
  'owner', // Administrator
  'office_manager', // Office
  'estimator',
  'project_manager',
  'field_foreman', // Field Staff (lead)
  'technician', // Field Staff
  'sales_rep', // Sales
  'client', // Client portal
  'subcontractor', // Subcontractor portal
]);

export const invitationStatusEnum = pgEnum('invitation_status', [
  'pending',
  'accepted',
  'revoked',
  'expired',
]);

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  logoUrl: text('logo_url'),
  tagline: text('tagline').default('Your Home, Our Mission.'),
  timezone: text('timezone').notNull().default('America/New_York'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey(), // mirrors Supabase auth.users.id
  email: text('email').notNull().unique(),
  fullName: text('full_name'),
  phone: text('phone'),
  avatarUrl: text('avatar_url'),
  isActive: boolean('is_active').notNull().default(true),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const organizationMembers = pgTable(
  'organization_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Union of granted roles = effective permissions (see lib/auth/rbac). */
    roles: userRoleEnum('roles').array().notNull().default([]),
    /** Owner-granted grants beyond the base roles (permission slugs). */
    extraPermissions: text('extra_permissions').array().notNull().default([]),
    isActive: boolean('is_active').notNull().default(true),
    invitedBy: uuid('invited_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('organization_members_org_user_idx').on(table.organizationId, table.userId),
  ],
);

export const invitations = pgTable('invitations', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  roles: userRoleEnum('roles').array().notNull().default([]),
  /** SHA-256 of the invite token; the raw token exists only in the invite URL. */
  tokenHash: text('token_hash').notNull().unique(),
  status: invitationStatusEnum('status').notNull().default('pending'),
  invitedBy: uuid('invited_by').references(() => users.id),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Organization = typeof organizations.$inferSelect;
export type User = typeof users.$inferSelect;
export type OrganizationMember = typeof organizationMembers.$inferSelect;
export type Invitation = typeof invitations.$inferSelect;
