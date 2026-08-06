CREATE TYPE "public"."work_unit_state" AS ENUM('proposed', 'approved', 'worked', 'worked_without_approval', 'invoiced', 'paid', 'disputed', 'revoked', 'rejected', 'unbillable');--> statement-breakpoint
CREATE TABLE "work_unit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"date" date NOT NULL,
	"quantity" numeric(6, 2) NOT NULL,
	"scope" text NOT NULL,
	"state" "work_unit_state" DEFAULT 'proposed' NOT NULL,
	"approval_id" uuid,
	"invoice_line_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_unit_transition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_unit_id" uuid NOT NULL,
	"from_state" "work_unit_state",
	"to_state" "work_unit_state" NOT NULL,
	"actor" jsonb NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_unit" ADD CONSTRAINT "work_unit_contract_id_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contract"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_unit" ADD CONSTRAINT "work_unit_approval_id_approval_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approval"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_unit_transition" ADD CONSTRAINT "work_unit_transition_work_unit_id_work_unit_id_fk" FOREIGN KEY ("work_unit_id") REFERENCES "public"."work_unit"("id") ON DELETE restrict ON UPDATE no action;