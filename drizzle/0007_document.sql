CREATE TYPE "public"."document_provenance" AS ENUM('folder_import', 'mail', 'upload', 'generated');--> statement-breakpoint
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
ALTER TABLE "document" ADD CONSTRAINT "document_contract_id_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contract"("id") ON DELETE restrict ON UPDATE no action;