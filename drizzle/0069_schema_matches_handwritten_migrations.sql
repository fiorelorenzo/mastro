-- Generated, not hand-written, and it exists to end a drift rather than to
-- change the database. Migrations 0067 and 0068 were written by hand, so the
-- generator never saw them: its snapshot still recorded
-- `inbound_thread.contract_id` as NOT NULL and both CHECK constraints in
-- their pre-#380 narrow form, while the live databases have carried the
-- widened forms since those migrations ran. Nothing was wrong in any
-- database; the *snapshot* was wrong, which is worse, because the next
-- generated migration for any reason would have emitted these statements
-- inverted and quietly undone #380.
--
-- So every statement here is a no-op against a database that ran 0067 and
-- 0068: dropping a NOT NULL that is already absent is allowed, and each
-- constraint is dropped and re-added with the definition it already has.
-- After this, `src/lib/server/db/schema/inbound-thread.ts`, the snapshot and
-- the database all say the same thing.

ALTER TABLE "inbound_thread" DROP CONSTRAINT "inbound_thread_archived_shape";--> statement-breakpoint
ALTER TABLE "inbound_thread" DROP CONSTRAINT "inbound_thread_skip_reason_known";--> statement-breakpoint
ALTER TABLE "inbound_thread" ALTER COLUMN "contract_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "inbound_thread" ADD CONSTRAINT "inbound_thread_archived_shape" CHECK (("inbound_thread"."archived" = true and "inbound_thread"."document_id" is not null and "inbound_thread"."message_size" is null
					and ("inbound_thread"."skip_reason" is null or "inbound_thread"."skip_reason" = 'sender_unknown'))
				or ("inbound_thread"."archived" = false and "inbound_thread"."document_id" is null and "inbound_thread"."skip_reason" is not null and "inbound_thread"."message_size" is not null));--> statement-breakpoint
ALTER TABLE "inbound_thread" ADD CONSTRAINT "inbound_thread_skip_reason_known" CHECK ("inbound_thread"."skip_reason" is null or "inbound_thread"."skip_reason" in ('oversized', 'sender_unknown'));