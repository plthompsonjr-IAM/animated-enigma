CREATE TYPE "public"."change_order_status" AS ENUM('draft', 'internal_review', 'sent', 'viewed', 'approved', 'declined', 'incorporated', 'canceled');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "change_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"change_order_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "change_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"contract_id" uuid,
	"change_order_number" text NOT NULL,
	"requested_by" text,
	"reason" text,
	"cost_change" numeric(14, 2) DEFAULT '0' NOT NULL,
	"schedule_change_days" integer DEFAULT 0,
	"internal_notes" text,
	"client_explanation" text,
	"status" "change_order_status" DEFAULT 'draft' NOT NULL,
	"approved_at" timestamp with time zone,
	"signature_id" uuid,
	"locked_at" timestamp with time zone,
	"secure_link_token_hash" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "change_order_items" ADD CONSTRAINT "change_order_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "change_order_items" ADD CONSTRAINT "change_order_items_change_order_id_change_orders_id_fk" FOREIGN KEY ("change_order_id") REFERENCES "public"."change_orders"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "change_orders" ADD CONSTRAINT "change_orders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "change_orders" ADD CONSTRAINT "change_orders_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "change_orders" ADD CONSTRAINT "change_orders_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "change_orders" ADD CONSTRAINT "change_orders_signature_id_signatures_id_fk" FOREIGN KEY ("signature_id") REFERENCES "public"."signatures"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "change_orders" ADD CONSTRAINT "change_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "change_order_items_order_idx" ON "change_order_items" USING btree ("change_order_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "change_orders_org_number_idx" ON "change_orders" USING btree ("organization_id","change_order_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "change_orders_project_idx" ON "change_orders" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "change_orders_contract_idx" ON "change_orders" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "change_orders_token_idx" ON "change_orders" USING btree ("secure_link_token_hash");