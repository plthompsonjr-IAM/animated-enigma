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