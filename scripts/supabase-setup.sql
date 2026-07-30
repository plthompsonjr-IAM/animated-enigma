-- PT's Tactical Foreman - full database setup for Supabase.
-- Paste this whole file into Supabase > SQL Editor > New query > Run.
-- Safe on a fresh project: creates all tables through Task 8 plus triggers
-- and row-level security. auth schema / auth.uid() already exist on Supabase;
-- the guards below skip re-creating them.
-- Generated from drizzle/0000-0003 at commit b1b446f.

-- ====================================================================
-- migration: 0000_deep_kinsey_walden
-- ====================================================================
CREATE TYPE "public"."invitation_status" AS ENUM('pending', 'accepted', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('owner', 'office_manager', 'estimator', 'project_manager', 'field_foreman', 'technician', 'sales_rep', 'client', 'subcontractor');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"roles" "user_role"[] DEFAULT '{}' NOT NULL,
	"token_hash" text NOT NULL,
	"status" "invitation_status" DEFAULT 'pending' NOT NULL,
	"invited_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_token_hash_unique" UNIQUE("token_hash")
);

CREATE TABLE IF NOT EXISTS "organization_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"roles" "user_role"[] DEFAULT '{}' NOT NULL,
	"extra_permissions" text[] DEFAULT '{}' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"invited_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo_url" text,
	"tagline" text DEFAULT 'Your Home, Our Mission.',
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);

CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"full_name" text,
	"phone" text,
	"avatar_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);

DO $$ BEGIN
 ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "organization_members_org_user_idx" ON "organization_members" USING btree ("organization_id","user_id");
-- ====================================================================
-- migration: 0001_auth_rls
-- ====================================================================
-- Task 6: helpers, triggers, and row-level security for the identity/tenancy domain.
-- Design source: docs/database-schema.md §1, §8.

create extension if not exists pgcrypto;

-- ── updated_at maintenance ────────────────────────────────────────────────────
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger organizations_set_updated_at before update on organizations
  for each row execute function set_updated_at();
create trigger users_set_updated_at before update on users
  for each row execute function set_updated_at();
create trigger organization_members_set_updated_at before update on organization_members
  for each row execute function set_updated_at();
create trigger invitations_set_updated_at before update on invitations
  for each row execute function set_updated_at();

-- ── JWT claim helpers (Supabase-compatible) ──────────────────────────────────
-- On Supabase, auth.uid() exists. Locally (plain Postgres test cluster) we
-- create a compatible stub reading request.jwt.claims, so the same policies
-- run in both environments.
create schema if not exists auth;

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'uid'
  ) then
    create function auth.uid() returns uuid language sql stable as $fn$
      select nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::uuid;
    $fn$;
  end if;
end $$;

create or replace function current_org() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb->>'org', '')::uuid;
$$;

-- Membership check that bypasses RLS (security definer) to avoid recursive
-- policy evaluation on organization_members.
create or replace function is_member_of(org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from organization_members m
    where m.organization_id = org and m.user_id = auth.uid() and m.is_active
  );
$$;

create or replace function has_role(org uuid, wanted user_role) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from organization_members m
    where m.organization_id = org and m.user_id = auth.uid()
      and m.is_active and wanted = any(m.roles)
  );
$$;

-- Must be security definer: inside a WITH CHECK, a plain subquery on
-- organization_members would itself be RLS-filtered, hiding existing members
-- and letting an attacker "bootstrap" themselves into a foreign organization.
create or replace function org_has_members(org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from organization_members m where m.organization_id = org
  );
$$;

-- ── Row-level security ───────────────────────────────────────────────────────
alter table organizations enable row level security;
alter table organizations force row level security;
alter table users enable row level security;
alter table users force row level security;
alter table organization_members enable row level security;
alter table organization_members force row level security;
alter table invitations enable row level security;
alter table invitations force row level security;

-- organizations: members can read their orgs; only owners can update; any
-- authenticated user can create an organization (they become its owner).
create policy organizations_select on organizations
  for select using (is_member_of(id));
create policy organizations_insert on organizations
  for insert with check (auth.uid() is not null);
create policy organizations_update on organizations
  for update using (has_role(id, 'owner')) with check (has_role(id, 'owner'));

-- users: a user sees/edits their own profile, plus profiles of people who
-- share an organization with them (needed for team lists and assignments).
create policy users_select on users
  for select using (
    id = auth.uid()
    or exists (
      select 1
      from organization_members mine
      join organization_members theirs
        on theirs.organization_id = mine.organization_id
      where mine.user_id = auth.uid() and mine.is_active
        and theirs.user_id = users.id and theirs.is_active
    )
  );
create policy users_insert on users
  for insert with check (id = auth.uid());
create policy users_update on users
  for update using (id = auth.uid()) with check (id = auth.uid());

-- organization_members: visible to fellow members; managed by owners. A user
-- may insert their own owner membership only for an organization that has no
-- members yet (bootstrap at org creation).
create policy organization_members_select on organization_members
  for select using (user_id = auth.uid() or is_member_of(organization_id));
create policy organization_members_insert on organization_members
  for insert with check (
    has_role(organization_id, 'owner')
    or (
      user_id = auth.uid()
      and 'owner' = any(roles)
      and not org_has_members(organization_id)
    )
  );
create policy organization_members_update on organization_members
  for update using (has_role(organization_id, 'owner'))
  with check (has_role(organization_id, 'owner'));
create policy organization_members_delete on organization_members
  for delete using (has_role(organization_id, 'owner'));

-- invitations: readable/manageable by owners and office managers of the org.
-- Acceptance is performed by the service role (token is the credential).
create policy invitations_select on invitations
  for select using (
    has_role(organization_id, 'owner') or has_role(organization_id, 'office_manager')
  );
create policy invitations_insert on invitations
  for insert with check (
    has_role(organization_id, 'owner') or has_role(organization_id, 'office_manager')
  );
create policy invitations_update on invitations
  for update using (
    has_role(organization_id, 'owner') or has_role(organization_id, 'office_manager')
  ) with check (
    has_role(organization_id, 'owner') or has_role(organization_id, 'office_manager')
  );

-- ====================================================================
-- migration: 0002_wild_reavers
-- ====================================================================
CREATE TYPE "public"."client_type" AS ENUM('individual', 'company');--> statement-breakpoint
CREATE TYPE "public"."lead_status" AS ENUM('new', 'contacted', 'qualified', 'site_visit_scheduled', 'estimating', 'proposal_sent', 'won', 'lost', 'on_hold');--> statement-breakpoint
CREATE TYPE "public"."priority" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('planning', 'scheduled', 'in_progress', 'punch_list', 'completed', 'warranty', 'closed', 'on_hold', 'cancelled');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_type" "client_type" DEFAULT 'individual' NOT NULL,
	"display_name" text NOT NULL,
	"company_name" text,
	"primary_phone" text,
	"primary_email" text,
	"billing_address" jsonb,
	"preferred_contact_method" text,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"notes" text,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "lead_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"activity_type" text NOT NULL,
	"summary" text,
	"metadata" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"lead_name" text NOT NULL,
	"client_name" text,
	"client_id" uuid,
	"property_id" uuid,
	"phone" text,
	"email" text,
	"property_address" jsonb,
	"project_type" text,
	"lead_source" text,
	"estimated_budget" numeric(14, 2),
	"desired_start_date" date,
	"description" text,
	"assigned_to" uuid,
	"status" "lead_status" DEFAULT 'new' NOT NULL,
	"priority" "priority" DEFAULT 'medium' NOT NULL,
	"next_follow_up_date" date,
	"notes" text,
	"converted_project_id" uuid,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_number" text NOT NULL,
	"name" text NOT NULL,
	"client_id" uuid NOT NULL,
	"property_id" uuid,
	"source_lead_id" uuid,
	"project_manager_id" uuid,
	"foreman_id" uuid,
	"salesperson_id" uuid,
	"status" "project_status" DEFAULT 'planning' NOT NULL,
	"project_type" text,
	"description" text,
	"internal_notes" text,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "properties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"address" jsonb NOT NULL,
	"property_type" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
 ALTER TABLE "clients" ADD CONSTRAINT "clients_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "clients" ADD CONSTRAINT "clients_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "leads" ADD CONSTRAINT "leads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "leads" ADD CONSTRAINT "leads_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "leads" ADD CONSTRAINT "leads_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "leads" ADD CONSTRAINT "leads_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "projects" ADD CONSTRAINT "projects_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "projects" ADD CONSTRAINT "projects_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "projects" ADD CONSTRAINT "projects_source_lead_id_leads_id_fk" FOREIGN KEY ("source_lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "projects" ADD CONSTRAINT "projects_project_manager_id_users_id_fk" FOREIGN KEY ("project_manager_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "projects" ADD CONSTRAINT "projects_foreman_id_users_id_fk" FOREIGN KEY ("foreman_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "projects" ADD CONSTRAINT "projects_salesperson_id_users_id_fk" FOREIGN KEY ("salesperson_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "properties" ADD CONSTRAINT "properties_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "properties" ADD CONSTRAINT "properties_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "clients_org_idx" ON "clients" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_activities_lead_idx" ON "lead_activities" USING btree ("lead_id","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_org_status_idx" ON "leads" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_org_followup_idx" ON "leads" USING btree ("organization_id","next_follow_up_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_assigned_idx" ON "leads" USING btree ("assigned_to");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "projects_org_number_idx" ON "projects" USING btree ("organization_id","project_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_org_status_idx" ON "projects" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "properties_client_idx" ON "properties" USING btree ("client_id");
-- ====================================================================
-- migration: 0003_crm_rls
-- ====================================================================
-- Task 8: deferred FK, updated_at triggers, and row-level security for the CRM
-- domain (leads, lead_activities, clients, properties, projects).
-- Design source: docs/database-schema.md §4.2, §4.3, §8.

-- Deferred FK: leads.converted_project_id → projects.id (circular at DDL time).
alter table leads
  add constraint leads_converted_project_fk
  foreign key (converted_project_id) references projects(id);

-- ── updated_at maintenance ────────────────────────────────────────────────────
create trigger clients_set_updated_at before update on clients
  for each row execute function set_updated_at();
create trigger properties_set_updated_at before update on properties
  for each row execute function set_updated_at();
create trigger leads_set_updated_at before update on leads
  for each row execute function set_updated_at();
create trigger projects_set_updated_at before update on projects
  for each row execute function set_updated_at();

-- ── Row-level security ───────────────────────────────────────────────────────
-- Baseline: a row is visible/writable only within the caller's active org
-- (current_org()), and only to members of that org (is_member_of). This is the
-- hard tenant boundary; role- and assignment-level rules layer on top in the
-- service/UI tier and in later tasks (e.g. field roles never see costs).

do $$
declare t text;
begin
  foreach t in array array['clients','properties','leads','lead_activities','projects']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($f$
      create policy %1$s_tenant on %1$I
        using (organization_id = current_org() and is_member_of(organization_id))
        with check (organization_id = current_org() and is_member_of(organization_id))
    $f$, t);
  end loop;
end $$;


-- ═══ Part 5 — Function hardening (mirrors drizzle/0004_function_hardening.sql) ═══

alter function set_updated_at() set search_path = public;
alter function current_org() set search_path = public;

do $$
begin
  revoke execute on function is_member_of(uuid) from public;
  revoke execute on function has_role(uuid, user_role) from public;
  revoke execute on function org_has_members(uuid) from public;

  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function is_member_of(uuid) from anon;
    revoke execute on function has_role(uuid, user_role) from anon;
    revoke execute on function org_has_members(uuid) from anon;
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function is_member_of(uuid) to authenticated;
    grant execute on function has_role(uuid, user_role) to authenticated;
    grant execute on function org_has_members(uuid) to authenticated;
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function is_member_of(uuid) to service_role;
    grant execute on function has_role(uuid, user_role) to service_role;
    grant execute on function org_has_members(uuid) to service_role;
  end if;
end $$;

-- ═══ Part 6 — Task 9: client contacts, property details, fuzzy search ═══
-- (mirrors drizzle/0005_black_boomerang.sql + 0006_client_contacts_rls.sql)

CREATE TABLE IF NOT EXISTS "client_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"role" text,
	"phone" text,
	"email" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "square_footage" integer;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "year_built" integer;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "occupancy_status" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "access_instructions" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "utility_info" jsonb;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "permit_jurisdiction" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_contacts_client_idx" ON "client_contacts" USING btree ("client_id");

create trigger client_contacts_set_updated_at before update on client_contacts
  for each row execute function set_updated_at();

alter table client_contacts enable row level security;
alter table client_contacts force row level security;
create policy client_contacts_tenant on client_contacts
  using (organization_id = current_org() and is_member_of(organization_id))
  with check (organization_id = current_org() and is_member_of(organization_id));

-- Fuzzy search + duplicate detection (§7): pg_trgm accelerates the ILIKE
-- lookups on client name/email and property street address.
create extension if not exists pg_trgm;
create index if not exists clients_display_name_trgm_idx
  on clients using gin (display_name gin_trgm_ops);
create index if not exists clients_primary_email_trgm_idx
  on clients using gin (primary_email gin_trgm_ops);
create index if not exists properties_address_line1_trgm_idx
  on properties using gin ((address->>'line1') gin_trgm_ops);

-- ═══ Part 7 — Relocate pg_trgm out of the public schema ═══

create schema if not exists extensions;
alter extension pg_trgm set schema extensions;

-- ═══ Part 8 — Task 11: project workspace (expanded projects, team, activity) ═══
-- (mirrors drizzle/0008_spotty_mojo.sql + 0009_project_workspace_rls.sql)

CREATE TYPE "public"."payment_state" AS ENUM('none', 'deposit_due', 'deposit_paid', 'partial', 'paid_in_full', 'overdue');--> statement-breakpoint
CREATE TYPE "public"."permit_status" AS ENUM('not_required', 'not_started', 'applied', 'approved', 'inspections', 'final_approved', 'closed');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"activity_type" text NOT NULL,
	"summary" text,
	"metadata" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_team_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid,
	"subcontractor_id" uuid,
	"role_on_project" "user_role",
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "contract_value" numeric(14, 2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "budget" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "expected_start" date;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "expected_completion" date;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "actual_start" date;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "actual_completion" date;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "permit_status" "permit_status" DEFAULT 'not_required' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "payment_state" "payment_state" DEFAULT 'none' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_activities" ADD CONSTRAINT "project_activities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_activities" ADD CONSTRAINT "project_activities_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_activities" ADD CONSTRAINT "project_activities_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_team_members" ADD CONSTRAINT "project_team_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_team_members" ADD CONSTRAINT "project_team_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_team_members" ADD CONSTRAINT "project_team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_activities_project_idx" ON "project_activities" USING btree ("project_id","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_team_project_idx" ON "project_team_members" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_team_unique_user_idx" ON "project_team_members" USING btree ("project_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_client_idx" ON "projects" USING btree ("client_id");
-- Task 11: updated_at triggers and tenant RLS for the project workspace tables
-- (project_team_members, project_activities). Same baseline tenant boundary as
-- the rest of the app: a row is visible/writable only to members of its org.
-- project_activities is append-only in the service tier; RLS still scopes reads.

create trigger project_team_members_set_updated_at before update on project_team_members
  for each row execute function set_updated_at();

do $$
declare t text;
begin
  foreach t in array array['project_team_members','project_activities']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($f$
      create policy %1$s_tenant on %1$I
        using (organization_id = current_org() and is_member_of(organization_id))
        with check (organization_id = current_org() and is_member_of(organization_id))
    $f$, t);
  end loop;
end $$;

-- ═══ Part 9 — Task 12: site visits (scheduling foundation) ═══
-- (mirrors drizzle/0010_red_ironclad.sql + 0011_site_visits_rls.sql)

CREATE TYPE "public"."site_visit_status" AS ENUM('scheduled', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."site_visit_type" AS ENUM('estimate', 'measurement', 'inspection', 'walkthrough', 'other');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "site_visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"lead_id" uuid,
	"project_id" uuid,
	"visit_type" "site_visit_type" DEFAULT 'estimate' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"duration_minutes" integer DEFAULT 60 NOT NULL,
	"completed_at" timestamp with time zone,
	"assigned_to" uuid,
	"status" "site_visit_status" DEFAULT 'scheduled' NOT NULL,
	"notes" text,
	"measurements" jsonb,
	"google_event_id" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_visits_org_scheduled_idx" ON "site_visits" USING btree ("organization_id","scheduled_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_visits_lead_idx" ON "site_visits" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_visits_project_idx" ON "site_visits" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "site_visits_assigned_idx" ON "site_visits" USING btree ("assigned_to");
-- Task 12: updated_at trigger and tenant RLS for site_visits. Same baseline
-- tenant boundary as the rest of the app: a row is visible/writable only to
-- members of its organization. Role-level rules (who may schedule/complete)
-- are enforced in the service tier.

create trigger site_visits_set_updated_at before update on site_visits
  for each row execute function set_updated_at();

alter table site_visits enable row level security;
alter table site_visits force row level security;
create policy site_visits_tenant on site_visits
  using (organization_id = current_org() and is_member_of(organization_id))
  with check (organization_id = current_org() and is_member_of(organization_id));

-- ═══ Part 10 — Task 13: scope of work (versioned) ═══
-- (mirrors drizzle/0012_wise_mesmero.sql + 0013_scope_fks_rls.sql)

CREATE TYPE "public"."version_status" AS ENUM('draft', 'in_review', 'approved', 'locked', 'superseded');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scope_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"scope_section_id" uuid NOT NULL,
	"description" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scope_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"scope_version_id" uuid NOT NULL,
	"section_type" text NOT NULL,
	"title" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scope_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"scope_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"status" "version_status" DEFAULT 'draft' NOT NULL,
	"source" text,
	"ai_generated" boolean DEFAULT false NOT NULL,
	"ai_generated_document_id" uuid,
	"notes" text,
	"locked_at" timestamp with time zone,
	"approved_by" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"current_version_id" uuid,
	"approved_version_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scope_items" ADD CONSTRAINT "scope_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scope_items" ADD CONSTRAINT "scope_items_scope_section_id_scope_sections_id_fk" FOREIGN KEY ("scope_section_id") REFERENCES "public"."scope_sections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scope_sections" ADD CONSTRAINT "scope_sections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scope_sections" ADD CONSTRAINT "scope_sections_scope_version_id_scope_versions_id_fk" FOREIGN KEY ("scope_version_id") REFERENCES "public"."scope_versions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scope_versions" ADD CONSTRAINT "scope_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scope_versions" ADD CONSTRAINT "scope_versions_scope_id_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."scopes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scope_versions" ADD CONSTRAINT "scope_versions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scope_versions" ADD CONSTRAINT "scope_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scopes" ADD CONSTRAINT "scopes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scopes" ADD CONSTRAINT "scopes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scopes" ADD CONSTRAINT "scopes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scope_items_section_idx" ON "scope_items" USING btree ("scope_section_id","sort_order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scope_sections_version_idx" ON "scope_sections" USING btree ("scope_version_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "scope_versions_number_idx" ON "scope_versions" USING btree ("scope_id","version_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scopes_project_idx" ON "scopes" USING btree ("project_id");
-- Task 13: deferred pointer FKs, updated_at triggers, and tenant RLS for the
-- versioned scope-of-work tables (docs/database-schema.md §4.4).

-- Deferred FKs: scopes → its current/approved version (circular at DDL time).
alter table scopes
  add constraint scopes_current_version_fk
  foreign key (current_version_id) references scope_versions(id);
alter table scopes
  add constraint scopes_approved_version_fk
  foreign key (approved_version_id) references scope_versions(id);

-- updated_at maintenance (scope_versions/sections/items are insert-only).
create trigger scopes_set_updated_at before update on scopes
  for each row execute function set_updated_at();

-- Tenant RLS: a row is visible/writable only to members of its organization.
do $$
declare t text;
begin
  foreach t in array array['scopes','scope_versions','scope_sections','scope_items']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($f$
      create policy %1$s_tenant on %1$I
        using (organization_id = current_org() and is_member_of(organization_id))
        with check (organization_id = current_org() and is_member_of(organization_id))
    $f$, t);
  end loop;
end $$;

-- ═══ Part 11 — Task 14: scope templates ═══
-- (mirrors drizzle/0014_melted_mimic.sql + 0015_scope_templates_rls.sql)

CREATE TABLE IF NOT EXISTS "scope_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"name" text NOT NULL,
	"project_type" text,
	"body" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scope_templates" ADD CONSTRAINT "scope_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "scope_templates" ADD CONSTRAINT "scope_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scope_templates_org_idx" ON "scope_templates" USING btree ("organization_id");
-- Task 14: updated_at trigger and RLS for scope_templates. Unlike the other
-- tenant tables, a template may be platform-global (organization_id is null),
-- readable by every org but writable by none through the app. Org-scoped rows
-- follow the usual tenant boundary.

create trigger scope_templates_set_updated_at before update on scope_templates
  for each row execute function set_updated_at();

alter table scope_templates enable row level security;
alter table scope_templates force row level security;

-- Read: your own org's templates, plus global (null-org) templates.
create policy scope_templates_read on scope_templates for select
  using (
    organization_id is null
    or (organization_id = current_org() and is_member_of(organization_id))
  );

-- Write: only your own org's templates (never global, never another org).
create policy scope_templates_insert on scope_templates for insert
  with check (organization_id = current_org() and is_member_of(organization_id));
create policy scope_templates_update on scope_templates for update
  using (organization_id = current_org() and is_member_of(organization_id))
  with check (organization_id = current_org() and is_member_of(organization_id));
create policy scope_templates_delete on scope_templates for delete
  using (organization_id = current_org() and is_member_of(organization_id));

-- ═══ Part 12 — Task 15: cost catalog ═══
-- (mirrors drizzle/0016_nappy_naoko.sql + 0017_cost_catalog_rls.sql)

CREATE TYPE "public"."material_tier" AS ENUM('economic', 'standard', 'premium');--> statement-breakpoint
CREATE TYPE "public"."unit_of_measure" AS ENUM('each', 'linear_foot', 'square_foot', 'cubic_yard', 'hour', 'day', 'allowance', 'lump_sum');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "catalog_price_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"catalog_item_id" uuid NOT NULL,
	"material_cost" numeric(12, 4),
	"labor_rate" numeric(12, 4),
	"effective_date" date DEFAULT now() NOT NULL,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cost_catalog_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"name" text NOT NULL,
	"trade" text,
	"description" text,
	"unit" "unit_of_measure" DEFAULT 'each' NOT NULL,
	"default_material_cost" numeric(12, 4) DEFAULT '0',
	"default_labor_hours" numeric(12, 4) DEFAULT '0',
	"default_labor_rate" numeric(12, 4) DEFAULT '0',
	"equipment_cost" numeric(12, 4) DEFAULT '0',
	"waste_pct" numeric(6, 4) DEFAULT '0',
	"vendor" text,
	"vendor_item_number" text,
	"region" text,
	"tier" "material_tier" DEFAULT 'standard',
	"last_verified_date" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "catalog_price_history" ADD CONSTRAINT "catalog_price_history_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "catalog_price_history" ADD CONSTRAINT "catalog_price_history_catalog_item_id_cost_catalog_items_id_fk" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."cost_catalog_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cost_catalog_items" ADD CONSTRAINT "cost_catalog_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cost_catalog_items" ADD CONSTRAINT "cost_catalog_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalog_price_history_item_idx" ON "catalog_price_history" USING btree ("catalog_item_id","effective_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cost_catalog_org_idx" ON "cost_catalog_items" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cost_catalog_trade_idx" ON "cost_catalog_items" USING btree ("trade");
-- Task 15: updated_at trigger and RLS for the cost catalog. Like scope
-- templates, a catalog item (and its price history) may be platform-global
-- (organization_id is null): readable by every org, writable by none through
-- the app. Org-scoped rows follow the usual tenant boundary.

create trigger cost_catalog_items_set_updated_at before update on cost_catalog_items
  for each row execute function set_updated_at();

do $$
declare t text;
begin
  foreach t in array array['cost_catalog_items','catalog_price_history']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    -- Read: your own org's rows plus global (null-org) rows.
    execute format($f$
      create policy %1$s_read on %1$I for select
        using (
          organization_id is null
          or (organization_id = current_org() and is_member_of(organization_id))
        )
    $f$, t);
    -- Write: only your own org's rows.
    execute format($f$
      create policy %1$s_insert on %1$I for insert
        with check (organization_id = current_org() and is_member_of(organization_id))
    $f$, t);
    execute format($f$
      create policy %1$s_update on %1$I for update
        using (organization_id = current_org() and is_member_of(organization_id))
        with check (organization_id = current_org() and is_member_of(organization_id))
    $f$, t);
    execute format($f$
      create policy %1$s_delete on %1$I for delete
        using (organization_id = current_org() and is_member_of(organization_id))
    $f$, t);
  end loop;
end $$;

-- ═══ Part 13 — Task 16: estimating ═══
-- (mirrors drizzle/0018_equal_gateway.sql + 0019_estimates_rls.sql)

CREATE TYPE "public"."line_item_type" AS ENUM('labor', 'material', 'equipment', 'subcontractor', 'allowance', 'other');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "estimate_line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"estimate_version_id" uuid NOT NULL,
	"catalog_item_id" uuid,
	"category" text,
	"description" text NOT NULL,
	"line_type" "line_item_type" DEFAULT 'material' NOT NULL,
	"quantity" numeric(12, 4) DEFAULT '1' NOT NULL,
	"unit" "unit_of_measure" DEFAULT 'each' NOT NULL,
	"unit_cost" numeric(12, 4) DEFAULT '0' NOT NULL,
	"waste_factor_pct" numeric(6, 4) DEFAULT '0',
	"taxable" boolean DEFAULT true NOT NULL,
	"line_cost" numeric(14, 2) DEFAULT '0',
	"sort_order" integer DEFAULT 0 NOT NULL,
	"ai_generated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "estimate_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"scope_version_id" uuid,
	"version_number" integer NOT NULL,
	"name" text,
	"status" "version_status" DEFAULT 'draft' NOT NULL,
	"ai_generated" boolean DEFAULT false NOT NULL,
	"ai_generated_document_id" uuid,
	"material_subtotal" numeric(14, 2) DEFAULT '0',
	"labor_subtotal" numeric(14, 2) DEFAULT '0',
	"equipment_subtotal" numeric(14, 2) DEFAULT '0',
	"subcontractor_subtotal" numeric(14, 2) DEFAULT '0',
	"direct_cost" numeric(14, 2) DEFAULT '0',
	"overhead_amount" numeric(14, 2) DEFAULT '0',
	"profit_amount" numeric(14, 2) DEFAULT '0',
	"tax_amount" numeric(14, 2) DEFAULT '0',
	"final_price" numeric(14, 2) DEFAULT '0',
	"gross_margin_pct" numeric(6, 4),
	"markup_pct" numeric(6, 4),
	"overhead_pct" numeric(6, 4) DEFAULT '0',
	"profit_pct" numeric(6, 4) DEFAULT '0',
	"tax_rate" numeric(6, 4) DEFAULT '0',
	"locked_at" timestamp with time zone,
	"approved_by" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "estimate_line_items" ADD CONSTRAINT "estimate_line_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "estimate_line_items" ADD CONSTRAINT "estimate_line_items_estimate_version_id_estimate_versions_id_fk" FOREIGN KEY ("estimate_version_id") REFERENCES "public"."estimate_versions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "estimate_line_items" ADD CONSTRAINT "estimate_line_items_catalog_item_id_cost_catalog_items_id_fk" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."cost_catalog_items"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "estimate_versions" ADD CONSTRAINT "estimate_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "estimate_versions" ADD CONSTRAINT "estimate_versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "estimate_versions" ADD CONSTRAINT "estimate_versions_scope_version_id_scope_versions_id_fk" FOREIGN KEY ("scope_version_id") REFERENCES "public"."scope_versions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "estimate_versions" ADD CONSTRAINT "estimate_versions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "estimate_versions" ADD CONSTRAINT "estimate_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "estimate_line_items_version_idx" ON "estimate_line_items" USING btree ("estimate_version_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "estimate_versions_number_idx" ON "estimate_versions" USING btree ("project_id","version_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "estimate_versions_project_idx" ON "estimate_versions" USING btree ("project_id");
-- Task 16: updated_at triggers and tenant RLS for the estimating tables.
-- Standard tenant boundary — a row is visible/writable only to members of its
-- organization. Role-level cost/margin visibility is enforced in the UI/service
-- tier (field roles never see money), not in RLS.

create trigger estimate_versions_set_updated_at before update on estimate_versions
  for each row execute function set_updated_at();
create trigger estimate_line_items_set_updated_at before update on estimate_line_items
  for each row execute function set_updated_at();

do $$
declare t text;
begin
  foreach t in array array['estimate_versions','estimate_line_items']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($f$
      create policy %1$s_tenant on %1$I
        using (organization_id = current_org() and is_member_of(organization_id))
        with check (organization_id = current_org() and is_member_of(organization_id))
    $f$, t);
  end loop;
end $$;

-- ═══ Part 14 — Task 17: proposals ═══
-- (mirrors drizzle/0020_sudden_kitty_pryde.sql + 0021_proposals_rls.sql)

CREATE TYPE "public"."proposal_status" AS ENUM('draft', 'sent', 'viewed', 'accepted', 'declined', 'changes_requested', 'expired');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "proposal_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"proposal_version_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"actor_email" text,
	"ip_address" text,
	"user_agent" text,
	"metadata" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "proposal_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"pdf_document_id" uuid,
	"content_snapshot" jsonb,
	"secure_link_token_hash" text,
	"locked_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"proposal_number" text NOT NULL,
	"estimate_version_id" uuid,
	"scope_version_id" uuid,
	"current_version_id" uuid,
	"status" "proposal_status" DEFAULT 'draft' NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proposal_events" ADD CONSTRAINT "proposal_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proposal_events" ADD CONSTRAINT "proposal_events_proposal_version_id_proposal_versions_id_fk" FOREIGN KEY ("proposal_version_id") REFERENCES "public"."proposal_versions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proposal_versions" ADD CONSTRAINT "proposal_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proposal_versions" ADD CONSTRAINT "proposal_versions_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proposal_versions" ADD CONSTRAINT "proposal_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proposals" ADD CONSTRAINT "proposals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proposals" ADD CONSTRAINT "proposals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proposals" ADD CONSTRAINT "proposals_estimate_version_id_estimate_versions_id_fk" FOREIGN KEY ("estimate_version_id") REFERENCES "public"."estimate_versions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proposals" ADD CONSTRAINT "proposals_scope_version_id_scope_versions_id_fk" FOREIGN KEY ("scope_version_id") REFERENCES "public"."scope_versions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "proposals" ADD CONSTRAINT "proposals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposal_events_version_idx" ON "proposal_events" USING btree ("proposal_version_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "proposal_versions_number_idx" ON "proposal_versions" USING btree ("proposal_id","version_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposal_versions_token_idx" ON "proposal_versions" USING btree ("secure_link_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "proposals_org_number_idx" ON "proposals" USING btree ("organization_id","proposal_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposals_project_idx" ON "proposals" USING btree ("project_id");
-- Task 17: deferred pointer FK, updated_at trigger, and tenant RLS for the
-- proposal tables. The public client view reads a proposal_version by its
-- secure-link token through the server (postgres/service role), so RLS here is
-- the internal tenant boundary only.

-- Deferred FK: proposals → its current version (circular at DDL time).
alter table proposals
  add constraint proposals_current_version_fk
  foreign key (current_version_id) references proposal_versions(id);

create trigger proposals_set_updated_at before update on proposals
  for each row execute function set_updated_at();

do $$
declare t text;
begin
  foreach t in array array['proposals','proposal_versions','proposal_events']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($f$
      create policy %1$s_tenant on %1$I
        using (organization_id = current_org() and is_member_of(organization_id))
        with check (organization_id = current_org() and is_member_of(organization_id))
    $f$, t);
  end loop;
end $$;

-- ═══ Part 15 — Task 19: e-signatures ═══

alter table organizations add column if not exists signature_disclosure text;

create table if not exists signatures (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  signable_type text not null,
  signable_id uuid not null,
  signer_name text not null,
  signer_email text,
  signature_image_url text,
  signed_at timestamptz not null default now(),
  ip_address text,
  user_agent text,
  disclosure_text text,
  locked_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists signatures_signable_idx on signatures (signable_type, signable_id);
create index if not exists signatures_org_idx on signatures (organization_id, signed_at);

-- Signatures are legal evidence: write-once for every role, including the
-- app's postgres role (which has BYPASSRLS).
create or replace function signatures_append_only() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  raise exception 'signatures are append-only: % is not permitted', tg_op
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists signatures_no_update on signatures;
create trigger signatures_no_update before update on signatures
  for each row execute function signatures_append_only();

drop trigger if exists signatures_no_delete on signatures;
create trigger signatures_no_delete before delete on signatures
  for each row execute function signatures_append_only();

alter table signatures enable row level security;
alter table signatures force row level security;

drop policy if exists signatures_tenant on signatures;
create policy signatures_tenant on signatures
  using (organization_id = current_org() and is_member_of(organization_id))
  with check (organization_id = current_org() and is_member_of(organization_id));

-- ═══ Part 16 — Task 20: contracts & payment schedules ═══

do $$ begin
  create type contract_status as enum ('draft','active','completed','cancelled');
exception when duplicate_object then null; end $$;

create table if not exists contracts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  project_id uuid not null references projects(id) on delete cascade,
  proposal_id uuid references proposals(id),
  contract_number text not null,
  status contract_status not null default 'draft',
  contract_value numeric(14,2) not null default 0,
  scope_summary text,
  pdf_document_id uuid,
  signed_signature_id uuid references signatures(id),
  activated_at timestamptz,
  locked_at timestamptz,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists contracts_org_number_idx on contracts (organization_id, contract_number);
create index if not exists contracts_project_idx on contracts (project_id);
create unique index if not exists contracts_proposal_idx on contracts (proposal_id);

create table if not exists payment_schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  contract_id uuid not null references contracts(id) on delete cascade,
  structure_type text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists payment_schedules_contract_idx on payment_schedules (contract_id);

create table if not exists payment_milestones (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  payment_schedule_id uuid not null references payment_schedules(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  amount numeric(14,2),
  percentage numeric(6,4),
  trigger_type text,
  due_date date,
  invoice_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists payment_milestones_schedule_idx
  on payment_milestones (payment_schedule_id, sort_order);

drop trigger if exists contracts_set_updated_at on contracts;
create trigger contracts_set_updated_at before update on contracts
  for each row execute function set_updated_at();
drop trigger if exists payment_schedules_set_updated_at on payment_schedules;
create trigger payment_schedules_set_updated_at before update on payment_schedules
  for each row execute function set_updated_at();
drop trigger if exists payment_milestones_set_updated_at on payment_milestones;
create trigger payment_milestones_set_updated_at before update on payment_milestones
  for each row execute function set_updated_at();

-- Financial integrity: a contract's money and linkage freeze once it is active.
create or replace function contracts_freeze_when_active() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if old.status <> 'draft' then
    if new.contract_value is distinct from old.contract_value
       or new.project_id is distinct from old.project_id
       or new.proposal_id is distinct from old.proposal_id
       or new.contract_number is distinct from old.contract_number
       or new.organization_id is distinct from old.organization_id then
      raise exception
        'contract % is % and its terms are frozen; issue a change order instead',
        old.contract_number, old.status
        using errcode = 'restrict_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists contracts_freeze on contracts;
create trigger contracts_freeze before update on contracts
  for each row execute function contracts_freeze_when_active();

create or replace function payment_terms_follow_contract() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  target_contract uuid;
  contract_status_value text;
begin
  if tg_table_name = 'payment_schedules' then
    target_contract := coalesce(new.contract_id, old.contract_id);
  else
    select s.contract_id into target_contract
      from public.payment_schedules s
      where s.id = coalesce(new.payment_schedule_id, old.payment_schedule_id);
  end if;

  select c.status::text into contract_status_value
    from public.contracts c where c.id = target_contract;

  if contract_status_value is not null and contract_status_value <> 'draft' then
    raise exception 'payment terms are frozen once the contract is %', contract_status_value
      using errcode = 'restrict_violation';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists payment_schedules_frozen on payment_schedules;
create trigger payment_schedules_frozen
  before insert or update or delete on payment_schedules
  for each row execute function payment_terms_follow_contract();

drop trigger if exists payment_milestones_frozen on payment_milestones;
create trigger payment_milestones_frozen
  before insert or update or delete on payment_milestones
  for each row execute function payment_terms_follow_contract();

do $$
declare t text;
begin
  foreach t in array array['contracts','payment_schedules','payment_milestones']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists %1$s_tenant on %1$I', t);
    execute format($f$
      create policy %1$s_tenant on %1$I
        using (organization_id = current_org() and is_member_of(organization_id))
        with check (organization_id = current_org() and is_member_of(organization_id))
    $f$, t);
  end loop;
end $$;

-- ═══ Part 17 — Task 20b: contract terms & conditions ═══
-- Per-org T&C text for the printable contract; null → built-in starter template.
alter table organizations add column if not exists contract_terms text;

-- ═══ Part 18 — Task 21: change orders ═══

do $$ begin
  create type change_order_status as enum ('draft','internal_review','sent','viewed',
    'approved','declined','incorporated','canceled');
exception when duplicate_object then null; end $$;

create table if not exists change_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  project_id uuid not null references projects(id) on delete cascade,
  contract_id uuid references contracts(id),
  change_order_number text not null,
  requested_by text,
  reason text,
  cost_change numeric(14,2) not null default 0,
  schedule_change_days integer default 0,
  internal_notes text,
  client_explanation text,
  status change_order_status not null default 'draft',
  approved_at timestamptz,
  signature_id uuid references signatures(id),
  locked_at timestamptz,
  secure_link_token_hash text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists change_order_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  change_order_id uuid not null references change_orders(id) on delete cascade,
  direction text not null,
  description text not null,
  amount numeric(14,2) not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists change_orders_org_number_idx
  on change_orders (organization_id, change_order_number);
create index if not exists change_orders_project_idx on change_orders (project_id);
create index if not exists change_orders_contract_idx on change_orders (contract_id);
create index if not exists change_orders_token_idx on change_orders (secure_link_token_hash);
create index if not exists change_order_items_order_idx
  on change_order_items (change_order_id, sort_order);

drop trigger if exists change_orders_set_updated_at on change_orders;
create trigger change_orders_set_updated_at before update on change_orders
  for each row execute function set_updated_at();

-- Approved change orders are evidence of agreement: their substance is frozen.
create or replace function change_orders_freeze_after_approval() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if old.status in ('approved', 'incorporated', 'canceled') then
    if new.cost_change is distinct from old.cost_change
       or new.schedule_change_days is distinct from old.schedule_change_days
       or new.client_explanation is distinct from old.client_explanation
       or new.change_order_number is distinct from old.change_order_number
       or new.project_id is distinct from old.project_id
       or new.contract_id is distinct from old.contract_id
       or new.organization_id is distinct from old.organization_id then
      raise exception
        'change order % is % and its terms are frozen; raise a new change order instead',
        old.change_order_number, old.status
        using errcode = 'restrict_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists change_orders_freeze on change_orders;
create trigger change_orders_freeze before update on change_orders
  for each row execute function change_orders_freeze_after_approval();

create or replace function change_order_items_follow_parent() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  parent_status text;
begin
  select co.status::text into parent_status
    from public.change_orders co
    where co.id = coalesce(new.change_order_id, old.change_order_id);

  if parent_status is not null
     and parent_status not in ('draft', 'internal_review') then
    raise exception 'change order line items are locked once the change order is %', parent_status
      using errcode = 'restrict_violation';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists change_order_items_locked on change_order_items;
create trigger change_order_items_locked
  before insert or update or delete on change_order_items
  for each row execute function change_order_items_follow_parent();

do $$
declare t text;
begin
  foreach t in array array['change_orders','change_order_items']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists %1$s_tenant on %1$I', t);
    execute format($f$
      create policy %1$s_tenant on %1$I
        using (organization_id = current_org() and is_member_of(organization_id))
        with check (organization_id = current_org() and is_member_of(organization_id))
    $f$, t);
  end loop;
end $$;

-- ═══ Part 19 — Task 22: invoices, payments & allocations ═══

do $$ begin
  create type invoice_status as enum ('draft','sent','viewed','partially_paid','paid','overdue','void');
exception when duplicate_object then null; end $$;
do $$ begin
  create type invoice_type as enum ('deposit','milestone','progress','change_order',
    'time_materials','final','maintenance');
exception when duplicate_object then null; end $$;
do $$ begin
  create type payment_method as enum ('card','ach','check','cash','other');
exception when duplicate_object then null; end $$;

create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  project_id uuid not null references projects(id) on delete cascade,
  client_id uuid not null references clients(id) on delete restrict,
  invoice_number text not null,
  invoice_type invoice_type not null,
  milestone_id uuid references payment_milestones(id),
  change_order_id uuid references change_orders(id),
  status invoice_status not null default 'draft',
  subtotal numeric(14,2) not null default 0,
  tax_rate numeric(6,4) not null default 0,
  tax_amount numeric(14,2) not null default 0,
  credits numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  amount_paid numeric(14,2) not null default 0,
  balance numeric(14,2) not null default 0,
  issued_at timestamptz,
  due_date date,
  payment_instructions text,
  notes text,
  pdf_document_id uuid,
  locked_at timestamptz,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists invoice_line_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  invoice_id uuid not null references invoices(id) on delete cascade,
  description text not null,
  quantity numeric(12,4) default 1,
  unit_price numeric(14,2) default 0,
  amount numeric(14,2) not null default 0,
  taxable boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  project_id uuid references projects(id),
  client_id uuid references clients(id),
  amount numeric(14,2) not null,
  payment_date date not null default now(),
  method payment_method not null,
  reference_number text,
  processor_fee numeric(14,2) default 0,
  is_refund boolean not null default false,
  notes text,
  external_id text,
  locked_at timestamptz,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists payment_allocations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  payment_id uuid not null references payments(id) on delete restrict,
  invoice_id uuid not null references invoices(id) on delete restrict,
  amount numeric(14,2) not null,
  locked_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists invoices_org_number_idx on invoices (organization_id, invoice_number);
create index if not exists invoices_project_idx on invoices (project_id);
create index if not exists invoices_client_idx on invoices (client_id);
create index if not exists invoices_status_due_idx on invoices (status, due_date);
create index if not exists invoice_line_items_invoice_idx on invoice_line_items (invoice_id, sort_order);
create unique index if not exists payments_org_external_idx on payments (organization_id, external_id);
create index if not exists payments_project_idx on payments (project_id);
create index if not exists payments_client_date_idx on payments (client_id, payment_date);
create index if not exists payment_allocations_payment_idx on payment_allocations (payment_id);
create index if not exists payment_allocations_invoice_idx on payment_allocations (invoice_id);

drop trigger if exists invoices_set_updated_at on invoices;
create trigger invoices_set_updated_at before update on invoices
  for each row execute function set_updated_at();
drop trigger if exists payments_set_updated_at on payments;
create trigger payments_set_updated_at before update on payments
  for each row execute function set_updated_at();

-- Issued invoices freeze their billed amounts, but must still accept payments.
create or replace function invoices_freeze_when_issued() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if old.status <> 'draft' then
    if new.subtotal is distinct from old.subtotal
       or new.tax_rate is distinct from old.tax_rate
       or new.tax_amount is distinct from old.tax_amount
       or new.credits is distinct from old.credits
       or new.total is distinct from old.total
       or new.invoice_number is distinct from old.invoice_number
       or new.invoice_type is distinct from old.invoice_type
       or new.project_id is distinct from old.project_id
       or new.client_id is distinct from old.client_id
       or new.organization_id is distinct from old.organization_id then
      raise exception
        'invoice % is issued (%) and its amounts are frozen; void and re-issue instead',
        old.invoice_number, old.status
        using errcode = 'restrict_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists invoices_freeze on invoices;
create trigger invoices_freeze before update on invoices
  for each row execute function invoices_freeze_when_issued();

create or replace function invoice_lines_follow_invoice() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  invoice_status_value text;
begin
  select i.status::text into invoice_status_value
    from public.invoices i
    where i.id = coalesce(new.invoice_id, old.invoice_id);

  if invoice_status_value is not null and invoice_status_value <> 'draft' then
    raise exception 'invoice line items are locked once the invoice is %', invoice_status_value
      using errcode = 'restrict_violation';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists invoice_line_items_locked on invoice_line_items;
create trigger invoice_line_items_locked
  before insert or update or delete on invoice_line_items
  for each row execute function invoice_lines_follow_invoice();

create or replace function payments_append_only_when_locked() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.locked_at is not null then
      raise exception 'locked payments cannot be deleted'
        using errcode = 'restrict_violation';
    end if;
    return old;
  end if;

  if old.locked_at is not null
     and (new.amount is distinct from old.amount
          or new.payment_date is distinct from old.payment_date
          or new.method is distinct from old.method
          or new.is_refund is distinct from old.is_refund
          or new.organization_id is distinct from old.organization_id) then
    raise exception 'payment is locked and cannot be altered'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists payments_locked on payments;
create trigger payments_locked
  before update or delete on payments
  for each row execute function payments_append_only_when_locked();

create or replace function payment_allocations_locked_guard() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if coalesce(old.locked_at, new.locked_at) is not null and tg_op <> 'INSERT' then
    if tg_op = 'DELETE' or new.amount is distinct from old.amount then
      raise exception 'payment allocation is locked and cannot be altered'
        using errcode = 'restrict_violation';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists payment_allocations_locked on payment_allocations;
create trigger payment_allocations_locked
  before update or delete on payment_allocations
  for each row execute function payment_allocations_locked_guard();

do $$
declare t text;
begin
  foreach t in array array['invoices','invoice_line_items','payments','payment_allocations']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists %1$s_tenant on %1$I', t);
    execute format($f$
      create policy %1$s_tenant on %1$I
        using (organization_id = current_org() and is_member_of(organization_id))
        with check (organization_id = current_org() and is_member_of(organization_id))
    $f$, t);
  end loop;
end $$;

-- ═══ Part 20 — change-order client approval links ═══

create table if not exists change_order_share_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  change_order_id uuid not null references change_orders(id) on delete cascade,
  token text,
  event_type text not null default 'shared',
  occurred_at timestamptz not null default now()
);
create index if not exists change_order_share_events_order_idx
  on change_order_share_events (change_order_id, occurred_at);

alter table change_order_share_events enable row level security;
alter table change_order_share_events force row level security;
drop policy if exists change_order_share_events_tenant on change_order_share_events;
create policy change_order_share_events_tenant on change_order_share_events
  using (organization_id = current_org() and is_member_of(organization_id))
  with check (organization_id = current_org() and is_member_of(organization_id));

-- ═══ Part 21 — Task 23: project schedule ═══

do $$ begin
  create type schedule_item_status as enum
    ('not_started', 'in_progress', 'blocked', 'complete', 'canceled');
exception when duplicate_object then null; end $$;

-- Dates are `date`, not timestamptz: a crew frames Tuesday through Friday, and
-- storing that as an instant makes the day shift with the reader's timezone.
create table if not exists schedule_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  phase text,
  start_date date not null,
  end_date date not null,
  status schedule_item_status not null default 'not_started',
  percent_complete integer not null default 0,
  depends_on_id uuid,
  notes text,
  sort_order integer not null default 0,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists schedule_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  schedule_item_id uuid not null references schedule_items(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists schedule_items_project_idx
  on schedule_items (project_id, start_date);
create index if not exists schedule_items_org_dates_idx
  on schedule_items (organization_id, start_date, end_date);
create index if not exists schedule_items_depends_idx on schedule_items (depends_on_id);
create unique index if not exists schedule_assignments_unique_idx
  on schedule_assignments (schedule_item_id, user_id);
create index if not exists schedule_assignments_user_idx on schedule_assignments (user_id);

-- A usable range, a sane percentage, and a predecessor that actually belongs to
-- the same job — guaranteed here so no query has to defend against them.
do $$ begin
  alter table schedule_items
    add constraint schedule_items_dates_ordered check (end_date >= start_date);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table schedule_items
    add constraint schedule_items_percent_bounds check (percent_complete between 0 and 100);
exception when duplicate_object then null; end $$;

-- Clearing rather than cascading: losing a predecessor should orphan the
-- dependency, not delete the successor's work.
do $$ begin
  alter table schedule_items
    add constraint schedule_items_depends_on_id_fk
    foreign key (depends_on_id) references schedule_items(id) on delete set null;
exception when duplicate_object then null; end $$;

create or replace function schedule_items_check_dependency() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  predecessor_project uuid;
begin
  if new.depends_on_id is null then
    return new;
  end if;

  if new.depends_on_id = new.id then
    raise exception 'a work item cannot depend on itself'
      using errcode = 'restrict_violation';
  end if;

  select s.project_id into predecessor_project
    from public.schedule_items s
    where s.id = new.depends_on_id;

  if predecessor_project is distinct from new.project_id then
    raise exception 'a work item can only depend on another item on the same project'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists schedule_items_dependency_guard on schedule_items;
create trigger schedule_items_dependency_guard
  before insert or update on schedule_items
  for each row execute function schedule_items_check_dependency();

drop trigger if exists schedule_items_set_updated_at on schedule_items;
create trigger schedule_items_set_updated_at before update on schedule_items
  for each row execute function set_updated_at();

do $$
declare t text;
begin
  foreach t in array array['schedule_items','schedule_assignments']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists %1$s_tenant on %1$I', t);
    execute format($f$
      create policy %1$s_tenant on %1$I
        using (organization_id = current_org() and is_member_of(organization_id))
        with check (organization_id = current_org() and is_member_of(organization_id))
    $f$, t);
  end loop;
end $$;

-- ═══ Part 22 — Task 24: field tasks, dependencies & checklists ═══

do $$ begin
  create type task_status as enum ('not_started','ready','in_progress','blocked',
    'awaiting_inspection','completed','rework_required');
exception when duplicate_object then null; end $$;

-- Field tasks are the work orders on a job, as distinct from the schedule's dated
-- phases: a task may have no dates at all ("fix the sticking door"). `blocked` is
-- never stored — it is derived from unfinished dependencies at read time, so
-- finishing a predecessor unblocks its successors with no second write.
create table if not exists project_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  project_id uuid not null references projects(id) on delete cascade,
  schedule_item_id uuid references schedule_items(id) on delete set null,
  title text not null,
  description text,
  assignee_id uuid references users(id),
  priority priority not null default 'medium',
  status task_status not null default 'not_started',
  is_punch_list boolean not null default false,
  start_date date,
  due_date date,
  estimated_hours numeric(12,4),
  actual_hours numeric(12,4),
  completed_at timestamptz,
  completion_verified_by uuid references users(id),
  supervisor_approved_by uuid references users(id),
  sort_order integer not null default 0,
  created_by uuid references users(id),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists task_dependencies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  task_id uuid not null references project_tasks(id) on delete cascade,
  depends_on_task_id uuid not null references project_tasks(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists task_checklist_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  task_id uuid not null references project_tasks(id) on delete cascade,
  label text not null,
  is_done boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists project_tasks_project_idx on project_tasks (project_id, sort_order);
create index if not exists project_tasks_assignee_idx on project_tasks (assignee_id, due_date);
create index if not exists project_tasks_org_due_idx on project_tasks (organization_id, due_date);
create index if not exists project_tasks_schedule_item_idx on project_tasks (schedule_item_id);
create unique index if not exists task_dependencies_unique_idx
  on task_dependencies (task_id, depends_on_task_id);
create index if not exists task_dependencies_depends_idx
  on task_dependencies (depends_on_task_id);
create index if not exists task_checklist_task_idx on task_checklist_items (task_id, sort_order);

do $$ begin
  alter table project_tasks
    add constraint project_tasks_dates_ordered
    check (start_date is null or due_date is null or due_date >= start_date);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table project_tasks
    add constraint project_tasks_hours_nonnegative
    check ((estimated_hours is null or estimated_hours >= 0)
       and (actual_hours is null or actual_hours >= 0));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table task_dependencies
    add constraint task_dependencies_not_self check (task_id <> depends_on_task_id);
exception when duplicate_object then null; end $$;

-- Keep completed_at in step with the status rather than trusting every caller.
-- A task sent back for rework loses its completion time.
create or replace function project_tasks_sync_completion() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if new.status = 'completed' then
    new.completed_at := coalesce(new.completed_at, now());
  else
    new.completed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists project_tasks_completion_sync on project_tasks;
create trigger project_tasks_completion_sync
  before insert or update on project_tasks
  for each row execute function project_tasks_sync_completion();

create or replace function task_dependencies_check_project() returns trigger
  language plpgsql
  set search_path = ''
as $$
declare
  task_project uuid;
  predecessor_project uuid;
begin
  select t.project_id into task_project
    from public.project_tasks t where t.id = new.task_id;
  select t.project_id into predecessor_project
    from public.project_tasks t where t.id = new.depends_on_task_id;

  if task_project is distinct from predecessor_project then
    raise exception 'a task can only depend on another task on the same project'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists task_dependencies_project_guard on task_dependencies;
create trigger task_dependencies_project_guard
  before insert or update on task_dependencies
  for each row execute function task_dependencies_check_project();

drop trigger if exists project_tasks_set_updated_at on project_tasks;
create trigger project_tasks_set_updated_at before update on project_tasks
  for each row execute function set_updated_at();

do $$
declare t text;
begin
  foreach t in array array['project_tasks','task_dependencies','task_checklist_items']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists %1$s_tenant on %1$I', t);
    execute format($f$
      create policy %1$s_tenant on %1$I
        using (organization_id = current_org() and is_member_of(organization_id))
        with check (organization_id = current_org() and is_member_of(organization_id))
    $f$, t);
  end loop;
end $$;
