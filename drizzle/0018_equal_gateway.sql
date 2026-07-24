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