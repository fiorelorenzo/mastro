-- #394: attribution by sender only, so the folder goes.
--
-- `inbound_thread.sender_address` keeps the `From` address the poll already
-- read and used to discard. Without it a contact added later cannot unblock
-- the messages already archived (#388), and nobody can see which addresses
-- are being refused - which is how a contact recorded as `leonardo@` came to
-- sit beside 407 archived messages from `leo@` with nothing anywhere saying
-- so. Nullable, because every row that already exists has no value for it
-- and a backfill reads it back out of the archived message.
--
-- `contract.mail_folder` was the other way to attribute a message: the IMAP
-- folder its approval mail was filed under (#84). #380 already made the
-- shared mailbox the default and the sender the attribution, leaving two
-- mechanisms for one job, and this is the one that asks a counterparty's
-- mail to arrive pre-sorted. Dropping the column also drops
-- `contract_mail_folder_key` (the partial unique index) and
-- `contract_mail_folder_not_blank` (the CHECK), both from the hand-written
-- 0034 and both scoped to this column alone, so Postgres removes them with
-- it and no explicit DROP is needed. Verified below rather than assumed.

ALTER TABLE "inbound_thread" ADD COLUMN "sender_address" text;--> statement-breakpoint
ALTER TABLE "contract" DROP COLUMN "mail_folder";