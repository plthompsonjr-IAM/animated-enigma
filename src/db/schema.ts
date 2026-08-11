import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  bigint,
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
  /** Jurisdiction disclosure shown at e-signing (Task 19); null → built-in default. */
  signatureDisclosure: text('signature_disclosure'),
  /** Contract terms & conditions; null → the built-in starter template. */
  contractTerms: text('contract_terms'),
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
    /**
     * What an hour of this person's time costs the business (Task 29) — burdened
     * cost, not their wage and not what the client is charged. Null means their
     * labour doesn't get costed, which is honest: a made-up rate would quietly
     * poison every margin on every job.
     */
    hourlyCostRate: numeric('hourly_cost_rate', { precision: 12, scale: 2 }),
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

export const permitStatusEnum = pgEnum('permit_status', [
  'not_required',
  'not_started',
  'applied',
  'approved',
  'inspections',
  'final_approved',
  'closed',
]);

export const paymentStateEnum = pgEnum('payment_state', [
  'none',
  'deposit_due',
  'deposit_paid',
  'partial',
  'paid_in_full',
  'overdue',
]);

/** Units of measure for cost-catalog items and estimate lines (Task 15). */
export const unitOfMeasureEnum = pgEnum('unit_of_measure', [
  'each',
  'linear_foot',
  'square_foot',
  'cubic_yard',
  'hour',
  'day',
  'allowance',
  'lump_sum',
]);

/** Quality tier for material catalog items (Task 15). */
export const materialTierEnum = pgEnum('material_tier', ['economic', 'standard', 'premium']);

/** Estimate line categories (Task 16). */
export const lineItemTypeEnum = pgEnum('line_item_type', [
  'labor',
  'material',
  'equipment',
  'subcontractor',
  'allowance',
  'other',
]);

/** Client-facing proposal lifecycle (Task 17). */
export const proposalStatusEnum = pgEnum('proposal_status', [
  'draft',
  'sent',
  'viewed',
  'accepted',
  'declined',
  'changes_requested',
  'expired',
]);

/** Invoice lifecycle (Task 22). */
export const invoiceStatusEnum = pgEnum('invoice_status', [
  'draft',
  'sent',
  'viewed',
  'partially_paid',
  'paid',
  'overdue',
  'void',
]);

/** What an invoice is billing for (Task 22). */
export const invoiceTypeEnum = pgEnum('invoice_type', [
  'deposit',
  'milestone',
  'progress',
  'change_order',
  'time_materials',
  'final',
  'maintenance',
]);

/** How money arrived. Provider-independent (Task 22). */
export const paymentMethodEnum = pgEnum('payment_method', [
  'card',
  'ach',
  'check',
  'cash',
  'other',
]);

/** Change-order approval lifecycle (Task 21). */
export const changeOrderStatusEnum = pgEnum('change_order_status', [
  'draft',
  'internal_review',
  'sent',
  'viewed',
  'approved',
  'declined',
  'incorporated',
  'canceled',
]);

/** Contract lifecycle (Task 20): frozen once it leaves draft. */
export const contractStatusEnum = pgEnum('contract_status', [
  'draft',
  'active',
  'completed',
  'cancelled',
]);

/**
 * Clients — the customer record (Tasks 8–9): an individual or company with
 * contact details, billing address, tags, and one or more properties.
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
 * Client contacts — additional people on a client account (Task 9): spouse,
 * site contact, office manager at a commercial client, etc.
 */
export const clientContacts = pgTable(
  'client_contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    role: text('role'),
    phone: text('phone'),
    email: text('email'),
    isPrimary: boolean('is_primary').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('client_contacts_client_idx').on(table.clientId)],
);

/**
 * Properties — the job sites (Tasks 8–9). A client can own several; jobsite
 * details (access, utilities, permit jurisdiction) live here so crews and
 * estimators see them on every project at that address.
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
    squareFootage: integer('square_footage'),
    yearBuilt: integer('year_built'),
    occupancyStatus: text('occupancy_status'),
    accessInstructions: text('access_instructions'),
    utilityInfo: jsonb('utility_info'),
    permitJurisdiction: text('permit_jurisdiction'),
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
    // Financials: contract_value is kept in sync by change orders (Task 30);
    // budget is the internal target. Both are visible only to cost-cleared roles.
    contractValue: numeric('contract_value', { precision: 14, scale: 2 }).default('0'),
    budget: numeric('budget', { precision: 14, scale: 2 }),
    // Key dates: expected (planned) vs actual (recorded as the job runs).
    expectedStart: date('expected_start'),
    expectedCompletion: date('expected_completion'),
    actualStart: date('actual_start'),
    actualCompletion: date('actual_completion'),
    permitStatus: permitStatusEnum('permit_status').notNull().default('not_required'),
    paymentState: paymentStateEnum('payment_state').notNull().default('none'),
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
    index('projects_client_idx').on(table.clientId),
  ],
);

/**
 * Project team — the internal people assigned to a project beyond the three
 * headline roles (PM/foreman/salesperson) stored on the project row. The
 * subcontractor FK is added once the subcontractors table exists (Task 33).
 */
export const projectTeamMembers = pgTable(
  'project_team_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id),
    subcontractorId: uuid('subcontractor_id'),
    roleOnProject: userRoleEnum('role_on_project'),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('project_team_project_idx').on(table.projectId),
    uniqueIndex('project_team_unique_user_idx').on(table.projectId, table.userId),
  ],
);

/**
 * Project activity timeline — status changes, assignments, notes, and
 * milestones, mirroring lead_activities. The workspace feed and the audit
 * trail both read from here.
 */
export const projectActivities = pgTable(
  'project_activities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    activityType: text('activity_type').notNull(),
    summary: text('summary'),
    metadata: jsonb('metadata'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('project_activities_project_idx').on(table.projectId, table.occurredAt)],
);

/** Shared version lifecycle for scopes (Task 13), estimates, and proposals. */
export const versionStatusEnum = pgEnum('version_status', [
  'draft',
  'in_review',
  'approved',
  'locked',
  'superseded',
]);

export const siteVisitStatusEnum = pgEnum('site_visit_status', [
  'scheduled',
  'completed',
  'cancelled',
]);

export const siteVisitTypeEnum = pgEnum('site_visit_type', [
  'estimate',
  'measurement',
  'inspection',
  'walkthrough',
  'other',
]);

/**
 * Site visits — scheduled trips to a lead's or project's property for an
 * estimate, measurement, inspection, or walkthrough (Task 12). Assigned to a
 * team member; carries free-form measurements and a google_event_id slot for
 * the calendar-sync groundwork (wired to Google Calendar in a later task).
 */
export const siteVisits = pgTable(
  'site_visits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    visitType: siteVisitTypeEnum('visit_type').notNull().default('estimate'),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    durationMinutes: integer('duration_minutes').notNull().default(60),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    assignedTo: uuid('assigned_to').references(() => users.id),
    status: siteVisitStatusEnum('status').notNull().default('scheduled'),
    notes: text('notes'),
    measurements: jsonb('measurements'),
    googleEventId: text('google_event_id'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('site_visits_org_scheduled_idx').on(table.organizationId, table.scheduledAt),
    index('site_visits_lead_idx').on(table.leadId),
    index('site_visits_project_idx').on(table.projectId),
    index('site_visits_assigned_idx').on(table.assignedTo),
  ],
);

/**
 * Scope of work (Task 13) — versioned. `scopes` is the stable per-project
 * container; each edit produces a new immutable `scope_versions` row (draft →
 * in_review → approved → locked, older ones superseded). The current/approved
 * pointer FKs are wired in the SQL migration (circular at DDL time).
 */
export const scopes = pgTable(
  'scopes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    currentVersionId: uuid('current_version_id'),
    approvedVersionId: uuid('approved_version_id'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('scopes_project_idx').on(table.projectId)],
);

/** Insert-only version snapshots — never edited in place once superseded. */
export const scopeVersions = pgTable(
  'scope_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    scopeId: uuid('scope_id')
      .notNull()
      .references(() => scopes.id, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull(),
    status: versionStatusEnum('status').notNull().default('draft'),
    source: text('source'), // scratch | copied | template | ai_generated
    aiGenerated: boolean('ai_generated').notNull().default(false),
    aiGeneratedDocumentId: uuid('ai_generated_document_id'),
    notes: text('notes'),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    approvedBy: uuid('approved_by').references(() => users.id),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('scope_versions_number_idx').on(table.scopeId, table.versionNumber)],
);

/** Sections group scope items by intent (included/excluded/allowance/…). */
export const scopeSections = pgTable(
  'scope_sections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    scopeVersionId: uuid('scope_version_id')
      .notNull()
      .references(() => scopeVersions.id, { onDelete: 'cascade' }),
    sectionType: text('section_type').notNull(),
    title: text('title').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('scope_sections_version_idx').on(table.scopeVersionId, table.sortOrder)],
);

export const scopeItems = pgTable(
  'scope_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    scopeSectionId: uuid('scope_section_id')
      .notNull()
      .references(() => scopeSections.id, { onDelete: 'cascade' }),
    description: text('description').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('scope_items_section_idx').on(table.scopeSectionId, table.sortOrder)],
);

/**
 * Scope templates (Task 14) — reusable scopes for common PTTR jobs. A null
 * organization_id marks a platform-global template visible to every org;
 * org-scoped rows are private to that org. `body` holds the section/item
 * outline as jsonb: { sections: [{ sectionType, title, items: [...] }] }.
 */
export const scopeTemplates = pgTable(
  'scope_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'cascade',
    }),
    name: text('name').notNull(),
    projectType: text('project_type'),
    body: jsonb('body').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('scope_templates_org_idx').on(table.organizationId)],
);

/**
 * Cost catalog (Task 15) — the library of labor/material/equipment items an
 * estimate is built from. A null organization_id marks a platform-global item
 * (visible to all, editable by none through the app); org rows are private.
 * Costs are stored to 4 decimals for accurate roll-ups.
 */
export const costCatalogItems = pgTable(
  'cost_catalog_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'cascade',
    }),
    name: text('name').notNull(),
    trade: text('trade'),
    description: text('description'),
    unit: unitOfMeasureEnum('unit').notNull().default('each'),
    defaultMaterialCost: numeric('default_material_cost', { precision: 12, scale: 4 }).default('0'),
    defaultLaborHours: numeric('default_labor_hours', { precision: 12, scale: 4 }).default('0'),
    defaultLaborRate: numeric('default_labor_rate', { precision: 12, scale: 4 }).default('0'),
    equipmentCost: numeric('equipment_cost', { precision: 12, scale: 4 }).default('0'),
    wastePct: numeric('waste_pct', { precision: 6, scale: 4 }).default('0'),
    vendor: text('vendor'),
    vendorItemNumber: text('vendor_item_number'),
    region: text('region'),
    tier: materialTierEnum('tier').default('standard'),
    lastVerifiedDate: date('last_verified_date'),
    isActive: boolean('is_active').notNull().default(true),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('cost_catalog_org_idx').on(table.organizationId),
    index('cost_catalog_trade_idx').on(table.trade),
  ],
);

/** Append-only price snapshots for a catalog item (Task 15). */
export const catalogPriceHistory = pgTable(
  'catalog_price_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'cascade',
    }),
    catalogItemId: uuid('catalog_item_id')
      .notNull()
      .references(() => costCatalogItems.id, { onDelete: 'cascade' }),
    materialCost: numeric('material_cost', { precision: 12, scale: 4 }),
    laborRate: numeric('labor_rate', { precision: 12, scale: 4 }),
    effectiveDate: date('effective_date').notNull().defaultNow(),
    source: text('source'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('catalog_price_history_item_idx').on(table.catalogItemId, table.effectiveDate)],
);

/**
 * Estimating (Task 16) — versioned per project. Each estimate_versions row is
 * an independent, named estimate (e.g. "Good"/"Better"/"Best") moving through
 * the shared draft→approved→locked lifecycle. Roll-up totals are computed by
 * the EstimateService (estimate-core.ts) and stored here for reporting.
 * Costs/margins are visible only to cost-cleared roles in the UI.
 */
export const estimateVersions = pgTable(
  'estimate_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    scopeVersionId: uuid('scope_version_id').references(() => scopeVersions.id),
    versionNumber: integer('version_number').notNull(),
    name: text('name'),
    status: versionStatusEnum('status').notNull().default('draft'),
    aiGenerated: boolean('ai_generated').notNull().default(false),
    aiGeneratedDocumentId: uuid('ai_generated_document_id'),
    // Roll-up totals (denormalized; recomputed on every line change).
    materialSubtotal: numeric('material_subtotal', { precision: 14, scale: 2 }).default('0'),
    laborSubtotal: numeric('labor_subtotal', { precision: 14, scale: 2 }).default('0'),
    equipmentSubtotal: numeric('equipment_subtotal', { precision: 14, scale: 2 }).default('0'),
    subcontractorSubtotal: numeric('subcontractor_subtotal', { precision: 14, scale: 2 }).default(
      '0',
    ),
    directCost: numeric('direct_cost', { precision: 14, scale: 2 }).default('0'),
    overheadAmount: numeric('overhead_amount', { precision: 14, scale: 2 }).default('0'),
    profitAmount: numeric('profit_amount', { precision: 14, scale: 2 }).default('0'),
    taxAmount: numeric('tax_amount', { precision: 14, scale: 2 }).default('0'),
    finalPrice: numeric('final_price', { precision: 14, scale: 2 }).default('0'),
    grossMarginPct: numeric('gross_margin_pct', { precision: 6, scale: 4 }),
    markupPct: numeric('markup_pct', { precision: 6, scale: 4 }),
    // Rates (fractions): overhead/profit applied to cost, tax on taxable price.
    overheadPct: numeric('overhead_pct', { precision: 6, scale: 4 }).default('0'),
    profitPct: numeric('profit_pct', { precision: 6, scale: 4 }).default('0'),
    taxRate: numeric('tax_rate', { precision: 6, scale: 4 }).default('0'),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    approvedBy: uuid('approved_by').references(() => users.id),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('estimate_versions_number_idx').on(table.projectId, table.versionNumber),
    index('estimate_versions_project_idx').on(table.projectId),
  ],
);

/**
 * Estimate line items (Task 16). Per-unit cost is carried on the line
 * (`unit_cost`) — snapshotted from a catalog item or entered directly — and
 * categorized by `line_type` for the subtotal roll-up. The design's per-type
 * subtype detail tables (labor_items, material_items, …) are a later
 * normalization refinement layered on top of this line model.
 */
export const estimateLineItems = pgTable(
  'estimate_line_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    estimateVersionId: uuid('estimate_version_id')
      .notNull()
      .references(() => estimateVersions.id, { onDelete: 'cascade' }),
    catalogItemId: uuid('catalog_item_id').references(() => costCatalogItems.id),
    category: text('category'),
    description: text('description').notNull(),
    lineType: lineItemTypeEnum('line_type').notNull().default('material'),
    quantity: numeric('quantity', { precision: 12, scale: 4 }).notNull().default('1'),
    unit: unitOfMeasureEnum('unit').notNull().default('each'),
    unitCost: numeric('unit_cost', { precision: 12, scale: 4 }).notNull().default('0'),
    wasteFactorPct: numeric('waste_factor_pct', { precision: 6, scale: 4 }).default('0'),
    taxable: boolean('taxable').notNull().default(true),
    lineCost: numeric('line_cost', { precision: 14, scale: 2 }).default('0'),
    sortOrder: integer('sort_order').notNull().default(0),
    aiGenerated: boolean('ai_generated').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('estimate_line_items_version_idx').on(table.estimateVersionId, table.sortOrder),
  ],
);

/**
 * Proposals (Task 17) — the client-facing document derived from an approved
 * estimate + scope. Each generated version snapshots a client-safe view model
 * (no costs/margins) and carries its own secure share-link token. Delivery and
 * engagement are audited in proposal_events. Signatures land in Task 19.
 */
export const proposals = pgTable(
  'proposals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    proposalNumber: text('proposal_number').notNull(),
    estimateVersionId: uuid('estimate_version_id').references(() => estimateVersions.id),
    scopeVersionId: uuid('scope_version_id').references(() => scopeVersions.id),
    currentVersionId: uuid('current_version_id'),
    status: proposalStatusEnum('status').notNull().default('draft'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('proposals_org_number_idx').on(table.organizationId, table.proposalNumber),
    index('proposals_project_idx').on(table.projectId),
  ],
);

/** Each generated proposal is a version with its own client-safe snapshot. */
export const proposalVersions = pgTable(
  'proposal_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => proposals.id, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull(),
    pdfDocumentId: uuid('pdf_document_id'),
    contentSnapshot: jsonb('content_snapshot'),
    secureLinkTokenHash: text('secure_link_token_hash'),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('proposal_versions_number_idx').on(table.proposalId, table.versionNumber),
    index('proposal_versions_token_idx').on(table.secureLinkTokenHash),
  ],
);

/** Delivery/engagement audit: sent, viewed, accepted, declined, … */
export const proposalEvents = pgTable(
  'proposal_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    proposalVersionId: uuid('proposal_version_id')
      .notNull()
      .references(() => proposalVersions.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    actorEmail: text('actor_email'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    metadata: jsonb('metadata'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('proposal_events_version_idx').on(table.proposalVersionId, table.occurredAt)],
);

/**
 * Contracts (Task 20) — the binding agreement created from an accepted,
 * signed proposal. Draft contracts are editable; once activated the row is
 * frozen (a DB trigger blocks changes to the money and linkage columns), so
 * corrections become formal revisions rather than silent edits.
 */
export const contracts = pgTable(
  'contracts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    proposalId: uuid('proposal_id').references(() => proposals.id),
    contractNumber: text('contract_number').notNull(),
    status: contractStatusEnum('status').notNull().default('draft'),
    contractValue: numeric('contract_value', { precision: 14, scale: 2 }).notNull().default('0'),
    scopeSummary: text('scope_summary'),
    pdfDocumentId: uuid('pdf_document_id'),
    signedSignatureId: uuid('signed_signature_id').references(() => signatures.id),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('contracts_org_number_idx').on(table.organizationId, table.contractNumber),
    index('contracts_project_idx').on(table.projectId),
    uniqueIndex('contracts_proposal_idx').on(table.proposalId),
  ],
);

/** How a contract gets paid — one schedule per contract. */
export const paymentSchedules = pgTable(
  'payment_schedules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    contractId: uuid('contract_id')
      .notNull()
      .references(() => contracts.id, { onDelete: 'cascade' }),
    structureType: text('structure_type').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('payment_schedules_contract_idx').on(table.contractId)],
);

/** The individual payments in a schedule (deposit, draws, final). */
export const paymentMilestones = pgTable(
  'payment_milestones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    paymentScheduleId: uuid('payment_schedule_id')
      .notNull()
      .references(() => paymentSchedules.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    amount: numeric('amount', { precision: 14, scale: 2 }),
    percentage: numeric('percentage', { precision: 6, scale: 4 }),
    triggerType: text('trigger_type'),
    dueDate: date('due_date'),
    invoiceId: uuid('invoice_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('payment_milestones_schedule_idx').on(table.paymentScheduleId, table.sortOrder),
  ],
);

/**
 * Change orders (Task 21) — the formal way to revise an active contract. A
 * change order never rewrites the signed contract value; the revised contract
 * sum is derived as original + approved change orders, so the agreement the
 * client signed stays intact and the arithmetic is always reconstructible.
 */
export const changeOrders = pgTable(
  'change_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    contractId: uuid('contract_id').references(() => contracts.id),
    changeOrderNumber: text('change_order_number').notNull(),
    requestedBy: text('requested_by'),
    reason: text('reason'),
    /** Net cost impact; may be negative (a credit). Derived from the items. */
    costChange: numeric('cost_change', { precision: 14, scale: 2 }).notNull().default('0'),
    scheduleChangeDays: integer('schedule_change_days').default(0),
    /** Never shown to the client. */
    internalNotes: text('internal_notes'),
    /** The client-facing explanation printed on the change order. */
    clientExplanation: text('client_explanation'),
    status: changeOrderStatusEnum('status').notNull().default('draft'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    signatureId: uuid('signature_id').references(() => signatures.id),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    secureLinkTokenHash: text('secure_link_token_hash'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('change_orders_org_number_idx').on(table.organizationId, table.changeOrderNumber),
    index('change_orders_project_idx').on(table.projectId),
    index('change_orders_contract_idx').on(table.contractId),
    index('change_orders_token_idx').on(table.secureLinkTokenHash),
  ],
);

/**
 * Delivery/engagement audit for change orders (mirrors proposal_events). Also
 * the one place the raw share token is surfaced, so the office can copy the
 * client link while only its hash lives on the change order itself.
 */
export const changeOrderShareEvents = pgTable(
  'change_order_share_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    changeOrderId: uuid('change_order_id')
      .notNull()
      .references(() => changeOrders.id, { onDelete: 'cascade' }),
    token: text('token'),
    eventType: text('event_type').notNull().default('shared'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('change_order_share_events_order_idx').on(table.changeOrderId, table.occurredAt),
  ],
);

/** The added/removed lines that make up a change order's cost impact. */
export const changeOrderItems = pgTable(
  'change_order_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    changeOrderId: uuid('change_order_id')
      .notNull()
      .references(() => changeOrders.id, { onDelete: 'cascade' }),
    direction: text('direction').notNull(),
    description: text('description').notNull(),
    /** Always stored as a positive magnitude; `direction` carries the sign. */
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull().default('0'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('change_order_items_order_idx').on(table.changeOrderId, table.sortOrder)],
);

/**
 * Invoices (Task 22). Draft invoices are editable; once issued the billed
 * amounts are frozen by a DB trigger — only the payment-derived columns
 * (amount_paid, balance), the status, and the lock bookkeeping may move. A
 * mistake on an issued invoice is corrected by voiding and re-issuing, so the
 * financial record stays append-only in spirit.
 *
 * `amount_paid` is a cache of the payment allocations; `invoices-core` can
 * always recompute it, so drift is detectable rather than authoritative.
 */
export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    invoiceNumber: text('invoice_number').notNull(),
    invoiceType: invoiceTypeEnum('invoice_type').notNull(),
    milestoneId: uuid('milestone_id').references(() => paymentMilestones.id),
    changeOrderId: uuid('change_order_id').references(() => changeOrders.id),
    status: invoiceStatusEnum('status').notNull().default('draft'),
    subtotal: numeric('subtotal', { precision: 14, scale: 2 }).notNull().default('0'),
    taxRate: numeric('tax_rate', { precision: 6, scale: 4 }).notNull().default('0'),
    taxAmount: numeric('tax_amount', { precision: 14, scale: 2 }).notNull().default('0'),
    credits: numeric('credits', { precision: 14, scale: 2 }).notNull().default('0'),
    total: numeric('total', { precision: 14, scale: 2 }).notNull().default('0'),
    /** Maintained from payment_allocations. */
    amountPaid: numeric('amount_paid', { precision: 14, scale: 2 }).notNull().default('0'),
    balance: numeric('balance', { precision: 14, scale: 2 }).notNull().default('0'),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    dueDate: date('due_date'),
    paymentInstructions: text('payment_instructions'),
    notes: text('notes'),
    pdfDocumentId: uuid('pdf_document_id'),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('invoices_org_number_idx').on(table.organizationId, table.invoiceNumber),
    index('invoices_project_idx').on(table.projectId),
    index('invoices_client_idx').on(table.clientId),
    index('invoices_status_due_idx').on(table.status, table.dueDate),
  ],
);

/** The billed lines. Tax applies per line so labor can be exempt. */
export const invoiceLineItems = pgTable(
  'invoice_line_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    description: text('description').notNull(),
    quantity: numeric('quantity', { precision: 12, scale: 4 }).default('1'),
    unitPrice: numeric('unit_price', { precision: 14, scale: 2 }).default('0'),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull().default('0'),
    taxable: boolean('taxable').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('invoice_line_items_invoice_idx').on(table.invoiceId, table.sortOrder)],
);

/**
 * Money received (or refunded). Deliberately provider-independent: `method`
 * plus an optional `externalId` that a processor like Stripe can own for
 * idempotency. Immutable once locked.
 */
export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id').references(() => projects.id),
    clientId: uuid('client_id').references(() => clients.id),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    paymentDate: date('payment_date').notNull().defaultNow(),
    method: paymentMethodEnum('method').notNull(),
    referenceNumber: text('reference_number'),
    processorFee: numeric('processor_fee', { precision: 14, scale: 2 }).default('0'),
    isRefund: boolean('is_refund').notNull().default(false),
    notes: text('notes'),
    /** Processor id; unique per org so a webhook retry cannot double-post. */
    externalId: text('external_id'),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('payments_org_external_idx').on(table.organizationId, table.externalId),
    index('payments_project_idx').on(table.projectId),
    index('payments_client_date_idx').on(table.clientId, table.paymentDate),
  ],
);

/** Applies a payment across one or more invoices. */
export const paymentAllocations = pgTable(
  'payment_allocations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id, { onDelete: 'restrict' }),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('payment_allocations_payment_idx').on(table.paymentId),
    index('payment_allocations_invoice_idx').on(table.invoiceId),
  ],
);

/**
 * E-signature records (Task 19). Polymorphic by design — one table serves
 * proposals now and change orders/contracts later via signableType/signableId.
 * Rows are append-only (a DB trigger blocks UPDATE/DELETE): a signature is
 * evidence, so corrections are new records, never edits. The disclosure text
 * shown to the signer is copied onto the row so we can always prove what was
 * agreed to, even if the org later changes its disclosure.
 */
export const signatures = pgTable(
  'signatures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    signableType: text('signable_type').notNull(),
    signableId: uuid('signable_id').notNull(),
    signerName: text('signer_name').notNull(),
    signerEmail: text('signer_email'),
    signatureImageUrl: text('signature_image_url'),
    signedAt: timestamp('signed_at', { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    disclosureText: text('disclosure_text'),
    lockedAt: timestamp('locked_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('signatures_signable_idx').on(table.signableType, table.signableId),
    index('signatures_org_idx').on(table.organizationId, table.signedAt),
  ],
);

export const scheduleItemStatusEnum = pgEnum('schedule_item_status', [
  'not_started',
  'in_progress',
  'blocked',
  'complete',
  'canceled',
]);

/**
 * Project schedule work items (Task 23) — the phases and tasks that make up a
 * job, each with a calendar-day range.
 *
 * Dates are `date`, not `timestamptz`, on purpose: a crew frames Tuesday through
 * Friday, and storing that as an instant means the day shifts with the reader's
 * timezone. `depends_on_id` is the predecessor in the trade sequence; it's
 * advisory (the app warns when a successor starts early) rather than enforced,
 * because a foreman legitimately overlaps trades. A CHECK keeps end_date on or
 * after start_date so no query has to defend against a backwards range.
 */
export const scheduleItems = pgTable(
  'schedule_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    phase: text('phase'),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    status: scheduleItemStatusEnum('status').notNull().default('not_started'),
    percentComplete: integer('percent_complete').notNull().default(0),
    /** Predecessor work item. Self-FK; set null if the predecessor is removed. */
    dependsOnId: uuid('depends_on_id'),
    notes: text('notes'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('schedule_items_project_idx').on(table.projectId, table.startDate),
    index('schedule_items_org_dates_idx').on(table.organizationId, table.startDate, table.endDate),
    index('schedule_items_depends_idx').on(table.dependsOnId),
  ],
);

/**
 * Who is on a work item. Separate from project_team_members: being on the
 * project's team is not the same as being booked for a specific week of work,
 * and conflict detection needs the dated form.
 */
export const scheduleAssignments = pgTable(
  'schedule_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    scheduleItemId: uuid('schedule_item_id')
      .notNull()
      .references(() => scheduleItems.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('schedule_assignments_unique_idx').on(table.scheduleItemId, table.userId),
    index('schedule_assignments_user_idx').on(table.userId),
  ],
);

export const taskStatusEnum = pgEnum('task_status', [
  'not_started',
  'ready',
  'in_progress',
  'blocked',
  'awaiting_inspection',
  'completed',
  'rework_required',
]);

/**
 * Field tasks (Task 24) — the actual work orders on a job, as distinct from the
 * schedule's dated phases. A task may have no dates at all ("fix the sticking
 * door") while a schedule item always spans days.
 *
 * `is_punch_list` marks the end-of-job snags so they can be tracked and closed
 * out as a group rather than scattered through the build. `blocked` is *not*
 * stored by the app — it's derived from unfinished dependencies at read time, so
 * finishing a predecessor unblocks its successors with no second write.
 */
export const projectTasks = pgTable(
  'project_tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** Optional link to the schedule phase this task belongs under. */
    scheduleItemId: uuid('schedule_item_id').references(() => scheduleItems.id, {
      onDelete: 'set null',
    }),
    title: text('title').notNull(),
    description: text('description'),
    assigneeId: uuid('assignee_id').references(() => users.id),
    priority: priorityEnum('priority').notNull().default('medium'),
    status: taskStatusEnum('status').notNull().default('not_started'),
    isPunchList: boolean('is_punch_list').notNull().default(false),
    startDate: date('start_date'),
    dueDate: date('due_date'),
    estimatedHours: numeric('estimated_hours', { precision: 12, scale: 4 }),
    actualHours: numeric('actual_hours', { precision: 12, scale: 4 }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    completionVerifiedBy: uuid('completion_verified_by').references(() => users.id),
    supervisorApprovedBy: uuid('supervisor_approved_by').references(() => users.id),
    sortOrder: integer('sort_order').notNull().default(0),
    createdBy: uuid('created_by').references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('project_tasks_project_idx').on(table.projectId, table.sortOrder),
    index('project_tasks_assignee_idx').on(table.assigneeId, table.dueDate),
    index('project_tasks_org_due_idx').on(table.organizationId, table.dueDate),
    index('project_tasks_schedule_item_idx').on(table.scheduleItemId),
  ],
);

/**
 * Task ordering constraints. Many-to-many — a task can wait on several others —
 * unlike the schedule's single predecessor. Cycles are checked in the app, where
 * the message can name the tasks involved.
 */
export const taskDependencies = pgTable(
  'task_dependencies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    taskId: uuid('task_id')
      .notNull()
      .references(() => projectTasks.id, { onDelete: 'cascade' }),
    dependsOnTaskId: uuid('depends_on_task_id')
      .notNull()
      .references(() => projectTasks.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('task_dependencies_unique_idx').on(table.taskId, table.dependsOnTaskId),
    index('task_dependencies_depends_idx').on(table.dependsOnTaskId),
  ],
);

/** A task's sub-steps. The foreman's own aide-mémoire, not a gate. */
export const taskChecklistItems = pgTable(
  'task_checklist_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    taskId: uuid('task_id')
      .notNull()
      .references(() => projectTasks.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    isDone: boolean('is_done').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('task_checklist_task_idx').on(table.taskId, table.sortOrder)],
);

/**
 * Daily logs (Task 25) — the contemporaneous record of what happened on a
 * jobsite. This is the document that decides delay claims and disputes, and its
 * value comes entirely from having been written that day.
 *
 * So: one log per project per day, a controlled edit window (`editable_until`,
 * enforced by a trigger, not by the app), and every edit inside that window
 * snapshotted to `daily_log_revisions` by a trigger so the history exists whether
 * or not the app remembers to write it. After the window closes, corrections go
 * in a later log — the record is not rewritten.
 */
export const dailyLogs = pgTable(
  'daily_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    logDate: date('log_date').notNull(),
    crewPresent: text('crew_present'),
    subsPresent: text('subs_present'),
    workCompleted: text('work_completed'),
    materialsDelivered: text('materials_delivered'),
    equipmentUsed: text('equipment_used'),
    weather: text('weather'),
    delays: text('delays'),
    problems: text('problems'),
    clientConversations: text('client_conversations'),
    safetyIncidents: text('safety_incidents'),
    inspectionActivity: text('inspection_activity'),
    workPlannedTomorrow: text('work_planned_tomorrow'),
    /** Edits are rejected past this instant. Set by a trigger on insert. */
    editableUntil: timestamp('editable_until', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('daily_logs_project_date_idx').on(table.projectId, table.logDate),
    index('daily_logs_org_date_idx').on(table.organizationId, table.logDate),
  ],
);

/**
 * Revision history for daily logs. Append-only at the database level — a
 * revision is evidence of what the log said before, so it can't be edited away.
 */
export const dailyLogRevisions = pgTable(
  'daily_log_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    dailyLogId: uuid('daily_log_id')
      .notNull()
      .references(() => dailyLogs.id, { onDelete: 'cascade' }),
    snapshot: jsonb('snapshot').notNull(),
    editedBy: uuid('edited_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('daily_log_revisions_log_idx').on(table.dailyLogId, table.createdAt)],
);

export const photoCategoryEnum = pgEnum('photo_category', [
  'before',
  'progress',
  'completion',
  'damage',
  'other',
]);

export const documentCategoryEnum = pgEnum('document_category', [
  'receipt',
  'plan',
  'permit',
  'inspection_report',
  'contract',
  'invoice',
  'product_spec',
  'warranty',
  'insurance',
  'w9',
  'other',
]);

/**
 * Jobsite photos (Task 26). `storage_path` points into a *private* Supabase
 * Storage bucket — the bytes are never public, and reads go through short-lived
 * signed URLs minted per request.
 *
 * `client_visible` is the gate for anything a client ever sees. It defaults to
 * false: a photo of a damaged subfloor or an open wall is an internal record
 * until somebody decides otherwise.
 */
export const photos = pgTable(
  'photos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    /** Optional link to the task or log this photo documents. */
    taskId: uuid('task_id').references(() => projectTasks.id, { onDelete: 'set null' }),
    dailyLogId: uuid('daily_log_id').references(() => dailyLogs.id, { onDelete: 'set null' }),
    storagePath: text('storage_path').notNull(),
    thumbnailPath: text('thumbnail_path'),
    mimeType: text('mime_type'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    category: photoCategoryEnum('category').notNull().default('progress'),
    caption: text('caption'),
    geolocation: jsonb('geolocation'),
    takenAt: timestamp('taken_at', { withTimezone: true }),
    clientVisible: boolean('client_visible').notNull().default(false),
    uploadedBy: uuid('uploaded_by').references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('photos_project_idx').on(table.projectId, table.createdAt),
    index('photos_org_idx').on(table.organizationId, table.createdAt),
    index('photos_task_idx').on(table.taskId),
    uniqueIndex('photos_storage_path_idx').on(table.storagePath),
  ],
);

/** Project documents — receipts, permits, plans, and generated PDFs. */
export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    storagePath: text('storage_path').notNull(),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    category: documentCategoryEnum('category').notNull().default('other'),
    /** True for system-generated PDFs rather than uploads. */
    isGenerated: boolean('is_generated').notNull().default(false),
    clientVisible: boolean('client_visible').notNull().default(false),
    notes: text('notes'),
    uploadedBy: uuid('uploaded_by').references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('documents_project_idx').on(table.projectId, table.createdAt),
    index('documents_org_category_idx').on(table.organizationId, table.category),
    uniqueIndex('documents_storage_path_idx').on(table.storagePath),
  ],
);

export const timeEntryStatusEnum = pgEnum('time_entry_status', [
  'open',
  'submitted',
  'approved',
  'rejected',
]);

export const expenseCategoryEnum = pgEnum('expense_category', [
  'material',
  'subcontractor',
  'equipment_rental',
  'permit_fee',
  'disposal',
  'fuel_mileage',
  'other',
]);

/**
 * Labour against a job (Task 29). `hours` is derived from the clock pair less
 * breaks, maintained by a trigger so it can never disagree with the times.
 *
 * A GiST exclusion constraint blocks a person having two overlapping shifts —
 * an open shift runs to infinity, so you can't start a second one while the
 * first is still going. That's an integrity rule the database holds, not a
 * check the app is trusted to remember.
 */
export const timeEntries = pgTable(
  'time_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id').references(() => projects.id),
    taskId: uuid('task_id').references(() => projectTasks.id, { onDelete: 'set null' }),
    clockIn: timestamp('clock_in', { withTimezone: true }),
    clockOut: timestamp('clock_out', { withTimezone: true }),
    breakMinutes: integer('break_minutes').notNull().default(0),
    /** Derived from clock_in/clock_out/break_minutes by a trigger. */
    hours: numeric('hours', { precision: 12, scale: 4 }),
    isManual: boolean('is_manual').notNull().default(false),
    status: timeEntryStatusEnum('status').notNull().default('open'),
    correctedBy: uuid('corrected_by').references(() => users.id),
    approvedBy: uuid('approved_by').references(() => users.id),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('time_entries_user_idx').on(table.userId, table.clockIn),
    index('time_entries_project_idx').on(table.projectId, table.clockIn),
    index('time_entries_org_idx').on(table.organizationId, table.clockIn),
  ],
);

/**
 * Money spent on a job — materials, subs, rentals, permits, disposal. Together
 * with time entries this is what makes a real margin possible; without both,
 * profitability is a projection from the estimate.
 *
 * `documentId` links a receipt so a cost is backed by evidence rather than
 * somebody's memory of a hardware-store run.
 */
export const expenses = pgTable(
  'expenses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id').references(() => projectTasks.id, { onDelete: 'set null' }),
    category: expenseCategoryEnum('category').notNull().default('material'),
    vendor: text('vendor'),
    description: text('description').notNull(),
    /** Negative is legitimate: a return or a refund. */
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    expenseDate: date('expense_date').notNull(),
    /** Receipt backing this cost. */
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
    /** Whether this is meant to be passed through to the client. */
    isBillable: boolean('is_billable').notNull().default(false),
    /** Set once the cost has been billed on to the client. */
    invoicedAt: timestamp('invoiced_at', { withTimezone: true }),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('expenses_project_idx').on(table.projectId, table.expenseDate),
    index('expenses_org_date_idx').on(table.organizationId, table.expenseDate),
    index('expenses_category_idx').on(table.organizationId, table.category),
  ],
);

// deferred self/forward references
// leads.convertedProjectId → projects.id is wired as a FK in the SQL migration
// to avoid a Drizzle circular-reference at table-definition time.
// scopes.current_version_id / approved_version_id → scope_versions.id likewise.
// proposals.current_version_id → proposal_versions.id likewise.
// schedule_items.depends_on_id → schedule_items.id likewise (self-reference).

export type Client = typeof clients.$inferSelect;
export type ClientContact = typeof clientContacts.$inferSelect;
export type Property = typeof properties.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
export type LeadActivity = typeof leadActivities.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type ProjectTeamMember = typeof projectTeamMembers.$inferSelect;
export type ProjectActivity = typeof projectActivities.$inferSelect;
export type SiteVisit = typeof siteVisits.$inferSelect;
export type Scope = typeof scopes.$inferSelect;
export type ScopeVersion = typeof scopeVersions.$inferSelect;
export type ScopeSection = typeof scopeSections.$inferSelect;
export type ScopeItem = typeof scopeItems.$inferSelect;
export type ScopeTemplate = typeof scopeTemplates.$inferSelect;
export type CostCatalogItem = typeof costCatalogItems.$inferSelect;
export type CatalogPriceHistory = typeof catalogPriceHistory.$inferSelect;
export type EstimateVersion = typeof estimateVersions.$inferSelect;
export type EstimateLineItem = typeof estimateLineItems.$inferSelect;
export type Proposal = typeof proposals.$inferSelect;
export type ProposalVersion = typeof proposalVersions.$inferSelect;
export type ProposalEvent = typeof proposalEvents.$inferSelect;
export type Signature = typeof signatures.$inferSelect;
export type NewSignature = typeof signatures.$inferInsert;
export type Contract = typeof contracts.$inferSelect;
export type NewContract = typeof contracts.$inferInsert;
export type PaymentSchedule = typeof paymentSchedules.$inferSelect;
export type PaymentMilestone = typeof paymentMilestones.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;
export type InvoiceLineItem = typeof invoiceLineItems.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;
export type PaymentAllocation = typeof paymentAllocations.$inferSelect;
export type ChangeOrder = typeof changeOrders.$inferSelect;
export type NewChangeOrder = typeof changeOrders.$inferInsert;
export type ChangeOrderItem = typeof changeOrderItems.$inferSelect;
export type ScheduleItem = typeof scheduleItems.$inferSelect;
export type NewScheduleItem = typeof scheduleItems.$inferInsert;
export type ScheduleAssignment = typeof scheduleAssignments.$inferSelect;
export type ProjectTask = typeof projectTasks.$inferSelect;
export type NewProjectTask = typeof projectTasks.$inferInsert;
export type TaskDependency = typeof taskDependencies.$inferSelect;
export type TaskChecklistItem = typeof taskChecklistItems.$inferSelect;
export type DailyLog = typeof dailyLogs.$inferSelect;
export type NewDailyLog = typeof dailyLogs.$inferInsert;
export type DailyLogRevision = typeof dailyLogRevisions.$inferSelect;
export type Photo = typeof photos.$inferSelect;
export type NewPhoto = typeof photos.$inferInsert;
export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type TimeEntry = typeof timeEntries.$inferSelect;
export type NewTimeEntry = typeof timeEntries.$inferInsert;
export type Expense = typeof expenses.$inferSelect;
export type NewExpense = typeof expenses.$inferInsert;
