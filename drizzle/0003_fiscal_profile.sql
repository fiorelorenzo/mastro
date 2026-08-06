CREATE TABLE "fiscal_profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pack_id" text NOT NULL,
	"pack_version" text NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiscal_profile_valid_range" CHECK ("fiscal_profile"."valid_to" is null or "fiscal_profile"."valid_from" < "fiscal_profile"."valid_to")
);
