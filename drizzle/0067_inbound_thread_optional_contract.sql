-- #380: watching a whole mailbox instead of one folder per contract.
--
-- Attribution stops being a precondition of archiving. A message arrives
-- before anyone knows whose it is, so `contract_id` becomes nullable and the
-- contract is a fact discovered afterwards - by matching the sender against
-- client contacts, or by a human. Every message that arrived through a
-- contract's own configured folder keeps its contract: the folder was the
-- attribution, and that path is unchanged.
ALTER TABLE "inbound_thread" ALTER COLUMN "contract_id" DROP NOT NULL;

-- Both uniqueness guarantees move from the contract to the mailbox, which is
-- what they were always really about. Their own comments in
-- `0034_mail_poll_constraints.sql` said so: "each contract's folder has its
-- own UID sequence" and "a Message-ID is only guaranteed unique within one
-- mailbox's own history". The contract was standing in for the mailbox
-- because there was exactly one folder per contract; with a shared mailbox
-- that proxy breaks, and keying on the mailbox is both correct and stricter -
-- two rows for one UID in one mailbox are now impossible even when they
-- carry different contracts, which is precisely the double-archive a
-- whole-mailbox pass could otherwise produce.
DROP INDEX IF EXISTS "inbound_thread_contract_uid_key";
DROP INDEX IF EXISTS "inbound_thread_contract_message_id_key";

CREATE UNIQUE INDEX "inbound_thread_mailbox_uid_key"
	ON "inbound_thread" (mailbox, imap_uid_validity, imap_uid);

-- Partial for the same reason as before: a Message-ID is not always present.
CREATE UNIQUE INDEX "inbound_thread_mailbox_message_id_key"
	ON "inbound_thread" (mailbox, message_id)
	WHERE message_id IS NOT NULL;
