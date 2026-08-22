CREATE TABLE "day_reading_conflict" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"date" date NOT NULL,
	"document_id" uuid NOT NULL,
	"extraction_run_id" uuid,
	"proposed_fields" jsonb,
	"excerpt" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "day_reading_conflict_contract_date_key" UNIQUE("contract_id","date")
);
--> statement-breakpoint
ALTER TABLE "day_reading_conflict" ADD CONSTRAINT "day_reading_conflict_contract_id_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contract"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_reading_conflict" ADD CONSTRAINT "day_reading_conflict_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_reading_conflict" ADD CONSTRAINT "day_reading_conflict_extraction_run_id_extraction_run_id_fk" FOREIGN KEY ("extraction_run_id") REFERENCES "public"."extraction_run"("id") ON DELETE restrict ON UPDATE no action;