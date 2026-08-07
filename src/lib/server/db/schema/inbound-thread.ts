import { relations } from 'drizzle-orm';
import { bigint, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps } from '../columns';
import { contract } from './contract';
import { document } from './document';

/**
 * One row per IMAP message the poller (#84) has handed off, per contract
 * (epic #15's ingestion pipeline: "document or thread -> ACP agent ->
 * proposed diff"). This table is the whole hand-off: writing the row *is*
 * making the thread available, there is no separate queue or notification.
 * Nothing in this repository reads it yet — the runner (#82) never
 * queries the database at all (its own read grant is scoped to `contract`
 * and `document` only), and the producer that will turn a row here into a
 * `proposal` is #85, not built this wave. Whoever builds that producer
 * reads `documentId`/`contractId` off a row here, invokes the runner with
 * that pair, and is free to add its own "already dispatched" bookkeeping
 * on top — this table only ever answers "has the poller seen this
 * message", never "has it been proposed from".
 *
 * `documentId` points at the archived raw message (#49's `document`,
 * `provenance: 'mail'`, `ownerType: 'contract'`, `ownerId: contractId` —
 * the message is evidence *for* the contract until a human or the future
 * accept path decides what it specifically evidences, so it is owned the
 * same way a contract's own signed PDF is, not by an `approval` row that
 * does not exist yet). `contractId` is denormalized onto this row too,
 * even though it is also on `document`, precisely so a reader never has
 * to join through `document` to answer "which contract does this belong
 * to" (#84's acceptance: "each handed-off thread carries the contract id
 * its folder/label maps to").
 *
 * `imapUidValidity`/`imapUid` are the durable seen-marker (#84's
 * acceptance: "reprocessing does not occur across restarts"). UIDs are
 * only stable within one `UIDVALIDITY` generation for a mailbox — RFC
 * 3501 SS2.3.1.1 — so the poller's "what's new" query is always scoped to
 * the *current* `imapUidValidity` (`maxImapUidForContract` in
 * `repositories/inbound-thread.ts`); a value never seen before for this
 * contract starts that contract's cursor at zero rather than reusing
 * another generation's UIDs, which is what makes a `UIDVALIDITY` bump
 * safe rather than a silent resync bug. `messageId` (the RFC 5322
 * `Message-ID` header, when the message carries one) is the second,
 * independent safety net for exactly that bump: `contract_mail_thread_
 * message_id_key` in the custom migration stops the *same* message,
 * re-numbered under a new `UIDVALIDITY`, from being handed off twice —
 * see `pollContractFolder` in `mail/poll.ts` for the check this backs.
 *
 * `mailbox`/`subject`/`receivedAt` are denormalized header values, not
 * extraction — invariant 4 and this issue's own non-goal ("you do not
 * read message content") are both satisfied by the fact that the archived
 * `document` is the only place the actual message lives; these three
 * columns exist purely so a human or a log line can identify a row
 * without reading the blob back off disk, the same role `document.
 * originalName` already plays.
 */
export const inboundThread = pgTable('inbound_thread', {
	id: id(),
	contractId: uuid('contract_id')
		.notNull()
		.references(() => contract.id, { onDelete: 'restrict' }),
	documentId: uuid('document_id')
		.notNull()
		.references(() => document.id, { onDelete: 'restrict' }),
	mailbox: text('mailbox').notNull(),
	imapUidValidity: bigint('imap_uid_validity', { mode: 'number' }).notNull(),
	imapUid: integer('imap_uid').notNull(),
	messageId: text('message_id'),
	subject: text('subject'),
	receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
	...timestamps()
});

export const inboundThreadRelations = relations(inboundThread, ({ one }) => ({
	contract: one(contract, { fields: [inboundThread.contractId], references: [contract.id] }),
	document: one(document, { fields: [inboundThread.documentId], references: [document.id] })
}));
