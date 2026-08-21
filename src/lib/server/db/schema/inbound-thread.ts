import { relations, sql } from 'drizzle-orm';
import {
	bigint,
	boolean,
	check,
	integer,
	pgTable,
	text,
	timestamp,
	uuid
} from 'drizzle-orm/pg-core';
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
 *
 * `archived`/`skipReason`/`messageSize` (#306) are the other shape this
 * row can take: a message the poller decided not to buffer whole because
 * `message.size` in the IMAP listing already exceeded
 * `IMAP_MAX_MESSAGE_BYTES` before `source` was ever fetched. Invariant 4
 * ("never keep only the extracted fields") cuts the other way here — the
 * bytes themselves are what gets dropped, on purpose, but the *fact the
 * message arrived* is not: `documentId` stays null (nothing was archived),
 * `skipReason` names why in a form the mail UI renders for a human, and
 * `messageSize` is the envelope-reported size at the moment of the
 * decision. `inbound_thread_archived_shape` (this file's own `check()`)
 * enforces the two shapes never mix — `archived = true` always carries a
 * `documentId` and no skip fields, `archived = false` always carries a
 * `skipReason`/`messageSize` and no `documentId` — so a caller cannot
 * half-write either one.
 */
/**
 * Why a message was archived without being handed to extraction.
 *
 * `'oversized'` is the RFC822 size guard (#306). `'sender_unknown'` is the
 * whole-mailbox mode (#380): watching an inbox means every newsletter is
 * archived too, and extraction costs a model call, so only a message whose
 * sender matches a known client contact is handed off. The message is kept
 * either way - invariant 4 does not care why we archived it - so a sender
 * added later makes the archived message extractable rather than lost.
 */
export type InboundThreadSkipReason = 'oversized' | 'sender_unknown';

export const inboundThread = pgTable(
	'inbound_thread',
	{
		id: id(),
		/**
		 * Which contract this message belongs to, when that is known.
		 *
		 * Null since #380: watching a whole mailbox means a message arrives
		 * before anyone knows whose it is, so attribution stopped being a
		 * precondition of archiving and became a fact discovered afterwards -
		 * by matching the sender against client contacts, or by a human. It
		 * stays non-null for every message that arrived through a contract's
		 * own configured folder, where the folder is the attribution.
		 */
		contractId: uuid('contract_id').references(() => contract.id, { onDelete: 'restrict' }),
		documentId: uuid('document_id').references(() => document.id, { onDelete: 'restrict' }),
		mailbox: text('mailbox').notNull(),
		imapUidValidity: bigint('imap_uid_validity', { mode: 'number' }).notNull(),
		imapUid: integer('imap_uid').notNull(),
		messageId: text('message_id'),
		subject: text('subject'),
		/**
		 * The `Message-ID` this message replies to, verbatim (#400).
		 *
		 * What turns a pile of messages back into the conversation they came
		 * from. Extraction reads one message at a time without it, which on
		 * the first real mailbox produced three proposals for one day: a
		 * reply quoting its parent re-stated the parent's sentence, and each
		 * message was judged with no knowledge of the answer it got. The
		 * Polymarket half-day is the case that makes it plain - the offer is
		 * in one message and the acceptance in the next, so no single message
		 * contains the approval.
		 *
		 * `In-Reply-To` only, not `References`. An IMAP envelope carries the
		 * first for free and not the second, and a second fetch per message
		 * to reconstruct a fuller chain buys nothing here: following
		 * `in_reply_to` to a message with none reaches the same root, and a
		 * broken chain (a client that dropped the header) degrades to two
		 * conversations rather than a wrong one.
		 *
		 * Null for a conversation's first message, and for every row archived
		 * before this column existed.
		 */
		inReplyTo: text('in_reply_to'),
		/**
		 * The `From` address, lower-cased and trimmed, as it arrived (#394).
		 *
		 * The poll already read this to decide attribution and then threw it
		 * away, keeping only the yes/no. That cost two things the product
		 * needs. A contact added later cannot unblock the messages already
		 * archived without it (#388), and nobody could see *which* addresses
		 * were being refused - which is how a contact recorded as
		 * `leonardo@` sat next to 407 archived messages from `leo@` with
		 * nothing anywhere saying so.
		 *
		 * Null on a row archived before this column existed and on one whose
		 * envelope carried no sender at all, so a reader must handle absence
		 * rather than assume every row has one.
		 */
		senderAddress: text('sender_address'),
		receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
		archived: boolean('archived').notNull().default(true),
		skipReason: text('skip_reason').$type<InboundThreadSkipReason>(),
		messageSize: integer('message_size'),
		...timestamps()
	},
	(table) => [
		// These two are kept in step with
		// `drizzle/0068_inbound_thread_archived_not_extracted.sql` by hand,
		// because that migration was hand-written and the generator cannot see
		// it. Drift here is not cosmetic: the next `db:generate` that touches
		// this table emits SQL from *this* text, so leaving the narrow forms
		// would silently revert the widening and reject every
		// `sender_unknown` row the mailbox pass writes.
		check(
			'inbound_thread_archived_shape',
			sql`(${table.archived} = true and ${table.documentId} is not null and ${table.messageSize} is null
					and (${table.skipReason} is null or ${table.skipReason} = 'sender_unknown'))
				or (${table.archived} = false and ${table.documentId} is null and ${table.skipReason} is not null and ${table.messageSize} is not null)`
		),
		check(
			'inbound_thread_skip_reason_known',
			sql`${table.skipReason} is null or ${table.skipReason} in ('oversized', 'sender_unknown')`
		)
	]
);

export const inboundThreadRelations = relations(inboundThread, ({ one }) => ({
	contract: one(contract, { fields: [inboundThread.contractId], references: [contract.id] }),
	document: one(document, { fields: [inboundThread.documentId], references: [document.id] })
}));
