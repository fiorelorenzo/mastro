CREATE TYPE "public"."contract_template_language" AS ENUM('en', 'it');--> statement-breakpoint
ALTER TABLE "contract" ADD COLUMN "template_language" "contract_template_language" DEFAULT 'en' NOT NULL;