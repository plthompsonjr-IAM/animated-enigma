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

