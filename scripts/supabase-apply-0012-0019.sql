-- Tactical Foreman — pending migrations 0012–0019 (Tasks 13–16)
-- Safe to run on a database that already has migrations 0000–0011 applied.
-- Paste into Supabase → SQL Editor → Run. Idempotent table creates; policies/triggers are new.

-- ═══════════════════════════════════════════════════════════════
-- drizzle/0012_wise_mesmero.sql
-- ═══════════════════════════════════════════════════════════════
CREATE TYPE "public"."version_status" AS ENUM('draft', 'in_review', 'approved', 'locked', 'superseded');
CREATE TABLE IF NOT EXISTS "scope_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"scope_section_id" uuid NOT NULL,
	"description" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "scope_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"scope_version_id" uuid NOT NULL,
	"section_type" text NOT NULL,
	"title" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

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

DO $$ BEGIN
 ALTER TABLE "scope_items" ADD CONSTRAINT "scope_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "scope_items" ADD CONSTRAINT "scope_items_scope_section_id_scope_sections_id_fk" FOREIGN KEY ("scope_section_id") REFERENCES "public"."scope_sections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "scope_sections" ADD CONSTRAINT "scope_sections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "scope_sections" ADD CONSTRAINT "scope_sections_scope_version_id_scope_versions_id_fk" FOREIGN KEY ("scope_version_id") REFERENCES "public"."scope_versions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "scope_versions" ADD CONSTRAINT "scope_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "scope_versions" ADD CONSTRAINT "scope_versions_scope_id_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."scopes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "scope_versions" ADD CONSTRAINT "scope_versions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "scope_versions" ADD CONSTRAINT "scope_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "scopes" ADD CONSTRAINT "scopes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "scopes" ADD CONSTRAINT "scopes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "scopes" ADD CONSTRAINT "scopes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "scope_items_section_idx" ON "scope_items" USING btree ("scope_section_id","sort_order");
CREATE INDEX IF NOT EXISTS "scope_sections_version_idx" ON "scope_sections" USING btree ("scope_version_id","sort_order");
CREATE UNIQUE INDEX IF NOT EXISTS "scope_versions_number_idx" ON "scope_versions" USING btree ("scope_id","version_number");
CREATE INDEX IF NOT EXISTS "scopes_project_idx" ON "scopes" USING btree ("project_id");
-- ═══════════════════════════════════════════════════════════════
-- drizzle/0013_scope_fks_rls.sql
-- ═══════════════════════════════════════════════════════════════
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

-- ═══════════════════════════════════════════════════════════════
-- drizzle/0014_melted_mimic.sql
-- ═══════════════════════════════════════════════════════════════
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

DO $$ BEGIN
 ALTER TABLE "scope_templates" ADD CONSTRAINT "scope_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "scope_templates" ADD CONSTRAINT "scope_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "scope_templates_org_idx" ON "scope_templates" USING btree ("organization_id");
-- ═══════════════════════════════════════════════════════════════
-- drizzle/0015_scope_templates_rls.sql
-- ═══════════════════════════════════════════════════════════════
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

-- ═══════════════════════════════════════════════════════════════
-- drizzle/0016_nappy_naoko.sql
-- ═══════════════════════════════════════════════════════════════
CREATE TYPE "public"."material_tier" AS ENUM('economic', 'standard', 'premium');
CREATE TYPE "public"."unit_of_measure" AS ENUM('each', 'linear_foot', 'square_foot', 'cubic_yard', 'hour', 'day', 'allowance', 'lump_sum');
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

DO $$ BEGIN
 ALTER TABLE "catalog_price_history" ADD CONSTRAINT "catalog_price_history_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "catalog_price_history" ADD CONSTRAINT "catalog_price_history_catalog_item_id_cost_catalog_items_id_fk" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."cost_catalog_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "cost_catalog_items" ADD CONSTRAINT "cost_catalog_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "cost_catalog_items" ADD CONSTRAINT "cost_catalog_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "catalog_price_history_item_idx" ON "catalog_price_history" USING btree ("catalog_item_id","effective_date");
CREATE INDEX IF NOT EXISTS "cost_catalog_org_idx" ON "cost_catalog_items" USING btree ("organization_id");
CREATE INDEX IF NOT EXISTS "cost_catalog_trade_idx" ON "cost_catalog_items" USING btree ("trade");
-- ═══════════════════════════════════════════════════════════════
-- drizzle/0017_cost_catalog_rls.sql
-- ═══════════════════════════════════════════════════════════════
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

-- ═══════════════════════════════════════════════════════════════
-- drizzle/0018_equal_gateway.sql
-- ═══════════════════════════════════════════════════════════════
CREATE TYPE "public"."line_item_type" AS ENUM('labor', 'material', 'equipment', 'subcontractor', 'allowance', 'other');
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

DO $$ BEGIN
 ALTER TABLE "estimate_line_items" ADD CONSTRAINT "estimate_line_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "estimate_line_items" ADD CONSTRAINT "estimate_line_items_estimate_version_id_estimate_versions_id_fk" FOREIGN KEY ("estimate_version_id") REFERENCES "public"."estimate_versions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "estimate_line_items" ADD CONSTRAINT "estimate_line_items_catalog_item_id_cost_catalog_items_id_fk" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."cost_catalog_items"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "estimate_versions" ADD CONSTRAINT "estimate_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "estimate_versions" ADD CONSTRAINT "estimate_versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "estimate_versions" ADD CONSTRAINT "estimate_versions_scope_version_id_scope_versions_id_fk" FOREIGN KEY ("scope_version_id") REFERENCES "public"."scope_versions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "estimate_versions" ADD CONSTRAINT "estimate_versions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "estimate_versions" ADD CONSTRAINT "estimate_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "estimate_line_items_version_idx" ON "estimate_line_items" USING btree ("estimate_version_id","sort_order");
CREATE UNIQUE INDEX IF NOT EXISTS "estimate_versions_number_idx" ON "estimate_versions" USING btree ("project_id","version_number");
CREATE INDEX IF NOT EXISTS "estimate_versions_project_idx" ON "estimate_versions" USING btree ("project_id");
-- ═══════════════════════════════════════════════════════════════
-- drizzle/0019_estimates_rls.sql
-- ═══════════════════════════════════════════════════════════════
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

