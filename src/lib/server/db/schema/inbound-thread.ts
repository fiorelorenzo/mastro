import { relations, sql } from 'drizzle-orm';
import {
	bigint,
	boolean,
	check,
	index,
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
export type InboundThreadSkipReason = 'oversized' | 'sender_unknown' | 'recipient_unknown';

/**
 * Which way a message travelled (#409).
 *
 * The table is named `inbound_thread` and now holds outbound messages too,
 * which is a name that has stopped being the whole truth. It is not renamed
 * because the rename is mechanical churn across every reader and every
 * migration that mentions it, and buys a better word rather than a better
 * guarantee; this column is what makes the distinction explicit at each use
 * site instead, and every read that means "what the client wrote" states it.
 *
 * A sent message matters because on a contract billed by written
 * confirmation the confirmation is often mine: the client offers a day and
 * asks for an ok, and my reply is the ok. Measured - with only the client's
 * two messages archived, the conversation reads as an offer and a thank-you
 * and proposes nothing, correctly, because the agreement between them is a
 * message the ledger never saw.
 */
export type MailDirection = 'inbound' | 'outbound';

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
		 * Its own header, verbatim, and null for a conversation's first
		 * message or for a row archived before this column existed.
		 */
		inReplyTo: text('in_reply_to'),
		/**
		 * Every `Message-ID` the `References` header names, oldest ancestor
		 * first (#410).
		 *
		 * `in_reply_to` alone cannot rebuild a conversation with a hole in
		 * it, and holes are normal here rather than exotic: the middle
		 * message of the first real approval on this ledger is one I sent,
		 * and nothing archives outbound mail (#409). Measured after the
		 * parents were backfilled - the offer and the reply to my answer
		 * stayed two conversations of one message each, both extracted
		 * alone, both proposing nothing, which is the exact failure #400
		 * removed arriving through another door.
		 *
		 * `References` names the whole ancestry, so a message two steps
		 * below a gap still points at everything above it. The one that
		 * broke carries `References: <offer> <my reply>` and therefore names
		 * the offer directly.
		 *
		 * This costs no extra IMAP round trip, which is what the comment
		 * here used to claim it would: an envelope does not carry
		 * `References`, but the poll already fetches the full source of
		 * every message it keeps, and the header block is in those bytes.
		 * Only kept messages get one, which is the same set that can ever
		 * reach extraction.
		 *
		 * Empty rather than null when the header is absent, so a reader
		 * never has to handle two shapes of "no ancestors".
		 */
		referenceIds: text('reference_ids').array().notNull().default([]),
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
		/**
		 * Whose message this is (#409). `inbound` for everything the watched
		 * mailbox receives, `outbound` for what the sent mailbox holds.
		 *
		 * Defaulted rather than backfilled: every row that existed before this
		 * column came from the inbox, so the default is the truth for all of
		 * them and there is nothing to rebuild.
		 */
		direction: text('direction').$type<MailDirection>().notNull().default('inbound'),
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
			sql`${table.skipReason} is null
				or ${table.skipReason} in ('oversized', 'sender_unknown', 'recipient_unknown')`
		),
		check('inbound_thread_direction_known', sql`${table.direction} in ('inbound', 'outbound')`),
		// A sent message is never refused for an unknown *sender* - the sender
		// is me - and an inbound one is never refused for an unknown recipient,
		// since the recipient is me as well. Getting these the wrong way round
		// is the mistake this constraint exists to catch, because both fields
		// are written by the same code path with the direction as its only
		// difference.
		check(
			'inbound_thread_skip_reason_matches_direction',
			sql`${table.skipReason} is null
				or (${table.direction} = 'inbound' and ${table.skipReason} in ('oversized', 'sender_unknown'))
				or (${table.direction} = 'outbound' and ${table.skipReason} in ('oversized', 'recipient_unknown'))`
		),
		// Grouping asks "which archived messages name any of these ancestors"
		// (#410), which is an array-overlap test. A GIN index is what answers
		// that without reading the table: cheap here today at a few hundred
		// rows, and the query runs on every enqueue tick forever.
		index('inbound_thread_reference_ids_gin').using('gin', table.referenceIds)
	]
);

export const inboundThreadRelations = relations(inboundThread, ({ one }) => ({
	contract: one(contract, { fields: [inboundThread.contractId], references: [contract.id] }),
	document: one(document, { fields: [inboundThread.documentId], references: [document.id] })
}));
