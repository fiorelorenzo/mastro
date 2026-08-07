CREATE TYPE "public"."ceiling_basis" AS ENUM('cash_received_calendar_year', 'invoiced_calendar_year', 'cash_received_contract_year');--> statement-breakpoint
CREATE TYPE "public"."ceiling_measure" AS ENUM('absolute_amount', 'percentage_share');--> statement-breakpoint
CREATE TABLE "ceiling" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label" jsonb NOT NULL,
	"legal_basis" jsonb,
	"measure" "ceiling_measure" NOT NULL,
	"absolute_value_minor_units" integer,
	"share_ratio" numeric(5, 4),
	"basis" "ceiling_basis" NOT NULL,
	"alert_levels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"consequence" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ceiling_contract_code_unique" UNIQUE("contract_id","code"),
	CONSTRAINT "ceiling_value_matches_measure" CHECK (("ceiling"."measure" = 'absolute_amount' and "ceiling"."absolute_value_minor_units" is not null and "ceiling"."share_ratio" is null)
				or ("ceiling"."measure" = 'percentage_share' and "ceiling"."share_ratio" is not null and "ceiling"."absolute_value_minor_units" is null)),
	CONSTRAINT "ceiling_absolute_value_non_negative" CHECK ("ceiling"."absolute_value_minor_units" is null or "ceiling"."absolute_value_minor_units" >= 0),
	CONSTRAINT "ceiling_share_ratio_range" CHECK ("ceiling"."share_ratio" is null or ("ceiling"."share_ratio" > 0 and "ceiling"."share_ratio" <= 1))
);
--> statement-breakpoint
ALTER TABLE "ceiling" ADD CONSTRAINT "ceiling_contract_id_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contract"("id") ON DELETE restrict ON UPDATE no action;