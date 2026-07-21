import { pgTable, uuid, text, timestamp, boolean } from 'drizzle-orm/pg-core';

/**
 * Database schema — foundation.
 *
 * The complete relational design lives in `docs/database-schema.md`. This module
 * is where those tables are translated into Drizzle definitions, table by table,
 * as each feature domain is built in later tasks. To keep the scaffold compiling
 * and the DB wiring provable, it starts with the tenant root (`organizations`)
 * and `users`; the remaining ~50 tables, RLS policies, and triggers are added in
 * the migrations that accompany Tasks 6+.
 */

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

export type Organization = typeof organizations.$inferSelect;
export type User = typeof users.$inferSelect;
