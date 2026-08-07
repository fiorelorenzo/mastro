CREATE TABLE "contract_renewal_assumption" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"probability" numeric(5, 4) NOT NULL,
	"expected_volume_minor_units" integer NOT NULL,
	"horizon_ends_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_renewal_assumption_contract_id_unique" UNIQUE("contract_id"),
	CONSTRAINT "contract_renewal_assumption_probability_range" CHECK ("contract_renewal_assumption"."probability" >= 0 and "contract_renewal_assumption"."probability" <= 1),
	CONSTRAINT "contract_renewal_assumption_volume_non_negative" CHECK ("contract_renewal_assumption"."expected_volume_minor_units" >= 0)
);
--> statement-breakpoint
ALTER TABLE "contract_renewal_assumption" ADD CONSTRAINT "contract_renewal_assumption_contract_id_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contract"("id") ON DELETE cascade ON UPDATE no action;