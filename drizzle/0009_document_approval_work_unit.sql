CREATE TYPE "public"."document_provenance" AS ENUM('folder_import', 'mail', 'upload', 'generated');--> statement-breakpoint
CREATE TYPE "public"."work_unit_state" AS ENUM('proposed', 'approved', 'worked', 'worked_without_approval', 'invoiced', 'paid', 'disputed', 'revoked', 'rejected', 'unbillable');--> statement-breakpoint
CREATE TABLE "approval" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"channel" "notice_channel" NOT NULL,
	"sender" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"message_id" text,
	"document_id" uuid NOT NULL,
	"excerpt" text NOT NULL,
	"origin" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hash" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"original_name" text NOT NULL,
	"provenance" "document_provenance" NOT NULL,
	"contract_id" uuid NOT NULL,
	"confidential" boolean NOT NULL,
	"owner_type" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"remote_file_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
ALTER TABLE "approval" ADD CONSTRAINT "approval_contract_id_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contract"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_contract_id_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contract"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_unit" ADD CONSTRAINT "work_unit_contract_id_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contract"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_unit" ADD CONSTRAINT "work_unit_approval_id_approval_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approval"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_unit_transition" ADD CONSTRAINT "work_unit_transition_work_unit_id_work_unit_id_fk" FOREIGN KEY ("work_unit_id") REFERENCES "public"."work_unit"("id") ON DELETE restrict ON UPDATE no action;