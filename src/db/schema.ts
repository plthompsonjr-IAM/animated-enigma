import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  boolean,
  numeric,
  date,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/**
 * Database schema.
 *
 * The complete relational design lives in `docs/database-schema.md`; tables are
 * translated here domain by domain as each task lands. Covered so far:
 *   • Identity/tenancy (Task 6): organizations, users, memberships, invitations.
 *   • CRM (Task 8): leads + lead_activities, and the core clients/properties/
 *     projects tables that lead conversion targets (fleshed out in Tasks 9/11).
 * RLS policies and triggers ship in the SQL migrations alongside the DDL.
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

// ── CRM domain (Task 8) ──────────────────────────────────────────────────────

export const leadStatusEnum = pgEnum('lead_status', [
  'new',
  'contacted',
  'qualified',
  'site_visit_scheduled',
  'estimating',
  'proposal_sent',
  'won',
  'lost',
  'on_hold',
]);

export const priorityEnum = pgEnum('priority', ['low', 'medium', 'high']);

export const clientTypeEnum = pgEnum('client_type', ['individual', 'company']);

export const projectStatusEnum = pgEnum('project_status', [
  'planning',
  'scheduled',
  'in_progress',
  'punch_list',
  'completed',
  'warranty',
  'closed',
  'on_hold',
  'cancelled',
]);

/**
 * Clients — core columns for lead conversion (Task 8). The full client &
 * property management UI and any additional columns arrive in Task 9.
 */
export const clients = pgTable(
  'clients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    clientType: clientTypeEnum('client_type').notNull().default('individual'),
    displayName: text('display_name').notNull(),
    companyName: text('company_name'),
    primaryPhone: text('primary_phone'),
    primaryEmail: text('primary_email'),
    billingAddress: jsonb('billing_address'),
    preferredContactMethod: text('preferred_contact_method'),
    tags: text('tags').array().notNull().default([]),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('clients_org_idx').on(table.organizationId)],
);

/**
 * Properties — core columns for lead conversion (Task 8). Expanded in Task 9.
 */
export const properties = pgTable(
  'properties',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    address: jsonb('address').notNull(),
    propertyType: text('property_type'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('properties_client_idx').on(table.clientId)],
);

/**
 * Leads — the full lead-management record (Task 8).
 */
export const leads = pgTable(
  'leads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    leadName: text('lead_name').notNull(),
    clientName: text('client_name'),
    clientId: uuid('client_id').references(() => clients.id),
    propertyId: uuid('property_id').references(() => properties.id),
    phone: text('phone'),
    email: text('email'),
    propertyAddress: jsonb('property_address'),
    projectType: text('project_type'),
    leadSource: text('lead_source'),
    estimatedBudget: numeric('estimated_budget', { precision: 14, scale: 2 }),
    desiredStartDate: date('desired_start_date'),
    description: text('description'),
    assignedTo: uuid('assigned_to').references(() => users.id),
    status: leadStatusEnum('status').notNull().default('new'),
    priority: priorityEnum('priority').notNull().default('medium'),
    nextFollowUpDate: date('next_follow_up_date'),
    notes: text('notes'),
    convertedProjectId: uuid('converted_project_id'),
    createdBy: uuid('created_by').references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('leads_org_status_idx').on(table.organizationId, table.status),
    index('leads_org_followup_idx').on(table.organizationId, table.nextFollowUpDate),
    index('leads_assigned_idx').on(table.assignedTo),
  ],
);

/**
 * Lead activities — the per-lead timeline of touches (Task 8): calls, emails,
 * status changes, assignments, notes, conversion.
 */
export const leadActivities = pgTable(
  'lead_activities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    activityType: text('activity_type').notNull(),
    summary: text('summary'),
    metadata: jsonb('metadata'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('lead_activities_lead_idx').on(table.leadId, table.occurredAt)],
);

/**
 * Projects — core columns for lead conversion (Task 8). The project workspace,
 * financial columns, and scheduling arrive in Task 11.
 */
export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    projectNumber: text('project_number').notNull(),
    name: text('name').notNull(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    propertyId: uuid('property_id').references(() => properties.id),
    sourceLeadId: uuid('source_lead_id').references(() => leads.id),
    projectManagerId: uuid('project_manager_id').references(() => users.id),
    foremanId: uuid('foreman_id').references(() => users.id),
    salespersonId: uuid('salesperson_id').references(() => users.id),
    status: projectStatusEnum('status').notNull().default('planning'),
    projectType: text('project_type'),
    description: text('description'),
    internalNotes: text('internal_notes'),
    createdBy: uuid('created_by').references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('projects_org_number_idx').on(table.organizationId, table.projectNumber),
    index('projects_org_status_idx').on(table.organizationId, table.status),
  ],
);

// deferred self/forward references
// leads.convertedProjectId → projects.id is wired as a FK in the SQL migration
// to avoid a Drizzle circular-reference at table-definition time.

export type Client = typeof clients.$inferSelect;
export type Property = typeof properties.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
export type LeadActivity = typeof leadActivities.$inferSelect;
export type Project = typeof projects.$inferSelect;
