CREATE TYPE "public"."expense_category" AS ENUM('material', 'subcontractor', 'equipment_rental', 'permit_fee', 'disposal', 'fuel_mileage', 'other');--> statement-breakpoint
CREATE TYPE "public"."time_entry_status" AS ENUM('open', 'submitted', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid,
	"category" "expense_category" DEFAULT 'material' NOT NULL,
	"vendor" text,
	"description" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"expense_date" date NOT NULL,
	"document_id" uuid,
	"is_billable" boolean DEFAULT false NOT NULL,
	"invoiced_at" timestamp with time zone,
	"notes" text,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "time_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid,
	"task_id" uuid,
	"clock_in" timestamp with time zone,
	"clock_out" timestamp with time zone,
	"break_minutes" integer DEFAULT 0 NOT NULL,
	"hours" numeric(12, 4),
	"is_manual" boolean DEFAULT false NOT NULL,
	"status" time_entry_status DEFAULT 'open' NOT NULL,
	"corrected_by" uuid,
	"approved_by" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization_members" ADD COLUMN "hourly_cost_rate" numeric(12, 2);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "expenses" ADD CONSTRAINT "expenses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "expenses" ADD CONSTRAINT "expenses_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "expenses" ADD CONSTRAINT "expenses_task_id_project_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."project_tasks"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "expenses" ADD CONSTRAINT "expenses_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_task_id_project_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."project_tasks"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_corrected_by_users_id_fk" FOREIGN KEY ("corrected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expenses_project_idx" ON "expenses" USING btree ("project_id","expense_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expenses_org_date_idx" ON "expenses" USING btree ("organization_id","expense_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expenses_category_idx" ON "expenses" USING btree ("organization_id","category");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_entries_user_idx" ON "time_entries" USING btree ("user_id","clock_in");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_entries_project_idx" ON "time_entries" USING btree ("project_id","clock_in");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_entries_org_idx" ON "time_entries" USING btree ("organization_id","clock_in");