CREATE TYPE "public"."mailbox_poll_run_status" AS ENUM('success', 'failure');--> statement-breakpoint
CREATE TABLE "inbound_thread" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"mailbox" text NOT NULL,
	"imap_uid_validity" bigint NOT NULL,
	"imap_uid" integer NOT NULL,
	"message_id" text,
	"subject" text,
	"received_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mailbox_poll_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "mailbox_poll_run_status" NOT NULL,
	"detail" text,
	"acknowledged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contract" ADD COLUMN "mail_folder" text;--> statement-breakpoint
ALTER TABLE "inbound_thread" ADD CONSTRAINT "inbound_thread_contract_id_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contract"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_thread" ADD CONSTRAINT "inbound_thread_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE restrict ON UPDATE no action;