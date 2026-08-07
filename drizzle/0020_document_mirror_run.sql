CREATE TYPE "public"."document_mirror_run_status" AS ENUM('success', 'failure');--> statement-breakpoint
CREATE TABLE "document_mirror_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"status" "document_mirror_run_status" NOT NULL,
	"detail" text,
	"acknowledged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_mirror_run" ADD CONSTRAINT "document_mirror_run_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;