CREATE TABLE IF NOT EXISTS "signatures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"signable_type" text NOT NULL,
	"signable_id" uuid NOT NULL,
	"signer_name" text NOT NULL,
	"signer_email" text,
	"signature_image_url" text,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"disclosure_text" text,
	"locked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "signature_disclosure" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "signatures" ADD CONSTRAINT "signatures_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signatures_signable_idx" ON "signatures" USING btree ("signable_type","signable_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signatures_org_idx" ON "signatures" USING btree ("organization_id","signed_at");