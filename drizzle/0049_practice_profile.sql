CREATE TABLE "practice_profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legal_name" text NOT NULL,
	"tax_id" text NOT NULL,
	"vat_id" text,
	"country" text NOT NULL,
	"address_line1" text NOT NULL,
	"address_line2" text,
	"address_city" text NOT NULL,
	"address_postal_code" text NOT NULL,
	"address_region" text,
	"singleton" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "practice_profile_singleton_unique" UNIQUE("singleton"),
	CONSTRAINT "practice_profile_singleton_true" CHECK ("practice_profile"."singleton" = true)
);
--> statement-breakpoint
-- `updated_at` maintenance for `practice_profile`, per AGENTS.md: every
-- table installs this trigger. Combined into this same migration (rather
-- than a follow-up file, the way `contract_renewal_assumption` split
-- table-plus-CHECKs and its trigger across two) because this wave
-- reserves exactly one migration index per slice (#258 -> 0049).
CREATE TRIGGER practice_profile_set_updated_at BEFORE UPDATE ON "practice_profile"
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();
