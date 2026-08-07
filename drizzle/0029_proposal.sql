CREATE TYPE "public"."proposal_status" AS ENUM('pending', 'accepted', 'rejected');--> statement-breakpoint
CREATE TABLE "proposal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"proposed_fields" jsonb NOT NULL,
	"excerpt" text NOT NULL,
	"confidence" numeric(3, 2) NOT NULL,
	"status" "proposal_status" DEFAULT 'pending' NOT NULL,
	"accepted_fields" jsonb,
	"result_id" uuid,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_contract_id_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contract"("id") ON DELETE restrict ON UPDATE no action;