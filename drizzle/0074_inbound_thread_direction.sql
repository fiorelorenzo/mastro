ALTER TABLE "inbound_thread" DROP CONSTRAINT "inbound_thread_skip_reason_known";--> statement-breakpoint
ALTER TABLE "inbound_thread" ADD COLUMN "direction" text DEFAULT 'inbound' NOT NULL;--> statement-breakpoint
ALTER TABLE "inbound_thread" ADD CONSTRAINT "inbound_thread_direction_known" CHECK ("inbound_thread"."direction" in ('inbound', 'outbound'));--> statement-breakpoint
ALTER TABLE "inbound_thread" ADD CONSTRAINT "inbound_thread_skip_reason_matches_direction" CHECK ("inbound_thread"."skip_reason" is null
				or ("inbound_thread"."direction" = 'inbound' and "inbound_thread"."skip_reason" in ('oversized', 'sender_unknown'))
				or ("inbound_thread"."direction" = 'outbound' and "inbound_thread"."skip_reason" in ('oversized', 'recipient_unknown')));--> statement-breakpoint
ALTER TABLE "inbound_thread" ADD CONSTRAINT "inbound_thread_skip_reason_known" CHECK ("inbound_thread"."skip_reason" is null
				or "inbound_thread"."skip_reason" in ('oversized', 'sender_unknown', 'recipient_unknown'));