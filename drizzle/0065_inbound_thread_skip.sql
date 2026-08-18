ALTER TABLE "inbound_thread" ALTER COLUMN "document_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "inbound_thread" ADD COLUMN "archived" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "inbound_thread" ADD COLUMN "skip_reason" text;--> statement-breakpoint
ALTER TABLE "inbound_thread" ADD COLUMN "message_size" integer;--> statement-breakpoint
ALTER TABLE "inbound_thread" ADD CONSTRAINT "inbound_thread_archived_shape" CHECK (("inbound_thread"."archived" = true and "inbound_thread"."document_id" is not null and "inbound_thread"."skip_reason" is null and "inbound_thread"."message_size" is null)
				or ("inbound_thread"."archived" = false and "inbound_thread"."document_id" is null and "inbound_thread"."skip_reason" is not null and "inbound_thread"."message_size" is not null));--> statement-breakpoint
ALTER TABLE "inbound_thread" ADD CONSTRAINT "inbound_thread_skip_reason_known" CHECK ("inbound_thread"."skip_reason" is null or "inbound_thread"."skip_reason" in ('oversized'));