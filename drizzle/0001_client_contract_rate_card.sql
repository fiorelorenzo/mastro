CREATE TYPE "public"."notice_channel" AS ENUM('email', 'certified_mail', 'registered_mail', 'courier', 'other');--> statement-breakpoint
CREATE TYPE "public"."contract_renewal_type" AS ENUM('none', 'explicit', 'counterparty_option', 'tacit');--> statement-breakpoint
CREATE TYPE "public"."contract_status" AS ENUM('draft', 'active', 'terminated', 'expired');--> statement-breakpoint
CREATE TYPE "public"."invoicing_cadence" AS ENUM('monthly', 'quarterly', 'annual', 'on_completion');--> statement-breakpoint
CREATE TYPE "public"."disbursement_period" AS ENUM('monthly', 'quarterly', 'annual', 'one_time');--> statement-breakpoint
CREATE TYPE "public"."rate_card_kind" AS ENUM('fixed_recurring', 'daily', 'hourly', 'one_off');--> statement-breakpoint
CREATE TYPE "public"."rate_unit" AS ENUM('hour', 'day', 'month', 'year', 'lump_sum');--> statement-breakpoint
CREATE TABLE "client" (
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
	"notice_channel" "notice_channel" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_tax_id_unique" UNIQUE("tax_id")
);
--> statement-breakpoint
CREATE TABLE "client_contact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"role" text,
	"can_approve" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"title" text NOT NULL,
	"signed_document_reference" text,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"renewal_type" "contract_renewal_type" NOT NULL,
	"renewal_notice_days" integer,
	"termination_notice_days" integer NOT NULL,
	"payment_terms" jsonb NOT NULL,
	"invoicing_cadence" "invoicing_cadence" NOT NULL,
	"currency" text NOT NULL,
	"tax_treatment" text NOT NULL,
	"requires_prior_approval" boolean DEFAULT false NOT NULL,
	"expense_policy" jsonb NOT NULL,
	"status" "contract_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_card" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"kind" "rate_card_kind" NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"unit" "rate_unit" NOT NULL,
	"allowed_fractions" numeric(4, 2)[] NOT NULL,
	"minimum_hours" numeric(6, 2),
	"disbursement_period" "disbursement_period",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_contact" ADD CONSTRAINT "client_contact_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract" ADD CONSTRAINT "contract_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_card" ADD CONSTRAINT "rate_card_contract_id_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contract"("id") ON DELETE restrict ON UPDATE no action;