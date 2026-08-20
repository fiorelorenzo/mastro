import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, expect, test } from 'vitest';
import { client as pool } from '$lib/server/db';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { client, clientContact, contract, document, inboundThread } from '$lib/server/db/schema';
import type { PaymentTerms } from '$lib/server/db/schema/contract';
import { storeDocument } from '$lib/server/repositories/document';
import {
	listInboundThreadsAwaitingExtraction,
	recordInboundThread,
	recordSkippedInboundThread
} from '$lib/server/repositories/inbound-thread';
import {
	attributeBySender,
	knownSenderAddresses,
	normaliseAddress,
	reattributeKnownSenders
} from './attribute';

// Needs a migrated database: `pnpm db:up && pnpm db:migrate`. Every case runs
// inside a transaction that is rolled back, and every assertion is scoped to
// the ids the case itself created — the seeded demo instance has its own
// clients and contacts, and this must hold with them present.

afterAll(async () => {
	await pool.end();
});

type Tx = Parameters<Parameters<typeof import('$lib/server/db').db.transaction>[0]>[0];

async function insertClientWithContract(
	tx: Tx,
	email: string,
	options: { contracts?: number; status?: 'active' | 'draft' } = {}
) {
	const [clientRow] = await tx
		.insert(client)
		.values({
			legalName: `Attribution ${crypto.randomUUID()}`,
			taxId: `ATTR-${crypto.randomUUID()}`,
			country: 'IT',
			addressLine1: 'Via Test 1',
			addressCity: 'Milano',
			addressPostalCode: '20100'
		})
		.returning();
	await tx.insert(clientContact).values({
		clientId: clientRow.id,
		name: 'Contact',
		email,
		canApprove: true
	});
	const contractIds: string[] = [];
	for (let i = 0; i < (options.contracts ?? 1); i++) {
		const [contractRow] = await tx
			.insert(contract)
			.values({
				clientId: clientRow.id,
				title: `Contract ${i}`,
				startsOn: '2024-01-01',
				renewalType: 'none' as const,
				terminationNoticeDays: 30,
				paymentTerms: { kind: 'net', days: 30 } satisfies PaymentTerms,
				invoicingCadence: 'monthly' as const,
				currency: 'EUR',
				taxTreatment: 'generic',
				expensePolicy: { kind: 'not_reimbursed' },
				requiresPriorApproval: false,
				appliesSocialCharge: false,
				status: options.status ?? 'active'
			})
			.returning();
		contractIds.push(contractRow.id);
	}
	return { clientId: clientRow.id, contractIds };
}

test('a sender that matches one contact of a client with one active contract attributes to it', async () => {
	const result = await inRolledBackTransaction(async (tx) => {
		const { clientId, contractIds } = await insertClientWithContract(tx, 'ada@acme.example');
		return { attributed: await attributeBySender('ada@acme.example', tx), clientId, contractIds };
	});

	expect(result.attributed).toEqual({
		contractId: result.contractIds[0],
		clientId: result.clientId
	});
});

test('a client with two active contracts is ambiguous, and ambiguous means nobody', async () => {
	// The shape that makes guessing wrong: a retainer plus a project for the
	// same counterparty. Picking one would be a guess presented as a fact.
	const attributed = await inRolledBackTransaction(async (tx) => {
		await insertClientWithContract(tx, 'two@acme.example', { contracts: 2 });
		return attributeBySender('two@acme.example', tx);
	});

	expect(attributed).toBeNull();
});

test('a sender nobody knows attributes to nobody', async () => {
	const attributed = await inRolledBackTransaction(async (tx) =>
		attributeBySender('stranger@nowhere.example', tx)
	);

	expect(attributed).toBeNull();
});

test('a draft contract is not a candidate: this month\u2019s mail does not belong to it', async () => {
	const attributed = await inRolledBackTransaction(async (tx) => {
		await insertClientWithContract(tx, 'draft@acme.example', { status: 'draft' });
		return attributeBySender('draft@acme.example', tx);
	});

	expect(attributed).toBeNull();
});

test('matching is case-insensitive and reads the address out of a From header', async () => {
	const result = await inRolledBackTransaction(async (tx) => {
		const { contractIds } = await insertClientWithContract(tx, 'ada@acme.example');
		return {
			contractIds,
			angled: await attributeBySender('Ada Lovelace <Ada@Acme.example>', tx),
			bare: await attributeBySender('ADA@ACME.EXAMPLE', tx)
		};
	});

	expect(result.angled?.contractId).toBe(result.contractIds[0]);
	expect(result.bare?.contractId).toBe(result.contractIds[0]);
});

test('the known-sender set contains the addresses the ledger knows, and nothing invented', async () => {
	const result = await inRolledBackTransaction(async (tx) => {
		await insertClientWithContract(tx, 'known@acme.example');
		return await knownSenderAddresses(tx);
	});

	expect(result.has('known@acme.example')).toBe(true);
	expect(result.has('stranger@nowhere.example')).toBe(false);
});

test('an address is only an address when it has an @', () => {
	// The pre-filter compares against this, so a header that is not an
	// address at all must not become a lookup key that accidentally matches.
	expect(normaliseAddress('Ada Lovelace')).toBeNull();
	expect(normaliseAddress('')).toBeNull();
	expect(normaliseAddress(null)).toBeNull();
	expect(normaliseAddress('  Ada <ADA@Acme.example>  ')).toBe('ada@acme.example');
});

// #388: `reattributeKnownSenders` re-decides attribution for messages
// archived while their sender was unknown, once a `client_contact` shows up
// that resolves them — the fix for a contact recorded as `leonardo@` sitting
// next to hundreds of messages actually sent from `leo@`, with nothing
// anywhere saying so. These cases write real bytes to disk through
// `storeDocument`, the same real filesystem side effect a rolled-back
// transaction cannot undo, so `DOCUMENT_STORAGE_ROOT` points at a throwaway
// temp directory removed in `afterEach` — same pattern as `alerts/engine.test.ts`.

let documentRoot: string;

beforeEach(async () => {
	documentRoot = await mkdtemp(join(tmpdir(), 'mastro-attribute-documents-'));
	process.env.DOCUMENT_STORAGE_ROOT = documentRoot;
});

afterEach(async () => {
	delete process.env.DOCUMENT_STORAGE_ROOT;
	await rm(documentRoot, { recursive: true, force: true });
});

// Monotonic rather than random: `inbound_thread_mailbox_uid_key` is unique
// on (mailbox, imap_uid_validity, imap_uid), and every case below shares one
// mailbox and one uidValidity on purpose, since #388's whole premise is
// several messages arriving into the one watched mailbox over time.
let nextImapUid = 1;
const REATTRIBUTION_MAILBOX = 'INBOX';
const REATTRIBUTION_UID_VALIDITY = 1_700_000_000;

async function insertUnclaimedDocument(tx: Tx) {
	return storeDocument(
		{
			bytes: new TextEncoder().encode('an archived message, arrived before its sender was known'),
			mime: 'message/rfc822',
			originalName: 'thread.eml',
			provenance: 'mail',
			contractId: null,
			confidential: true,
			ownerType: null,
			ownerId: null
		},
		tx
	);
}

/** A message archived under `skip_reason = 'sender_unknown'` (#380), the
 * shape every row #388 exists to revisit. `documentId` is a real, unclaimed
 * `document` — `document_unclaimed_together` requires `contractId`,
 * `ownerType` and `ownerId` to be null exactly together with it. */
async function insertUnknownSenderThread(tx: Tx, documentId: string, senderAddress: string | null) {
	const row = await recordInboundThread(
		{
			contractId: null,
			documentId,
			mailbox: REATTRIBUTION_MAILBOX,
			imapUidValidity: REATTRIBUTION_UID_VALIDITY,
			imapUid: nextImapUid++,
			messageId: `<${crypto.randomUUID()}@example.com>`,
			subject: 'a message from before the contact existed',
			senderAddress,
			receivedAt: new Date('2026-08-01T09:00:00.000Z'),
			skipReason: 'sender_unknown'
		},
		tx
	);
	if (!row) throw new Error('insertUnknownSenderThread: onConflictDoNothing swallowed the insert');
	return row;
}

/** A message refused for size (#306), never archived — `reattributeKnownSenders`
 * only ever selects `skip_reason = 'sender_unknown'`, so this shape must stay
 * completely outside its reach even when the sender now resolves cleanly. */
async function insertOversizedThread(tx: Tx, senderAddress: string | null) {
	const row = await recordSkippedInboundThread(
		{
			contractId: null,
			mailbox: REATTRIBUTION_MAILBOX,
			imapUidValidity: REATTRIBUTION_UID_VALIDITY,
			imapUid: nextImapUid++,
			messageId: `<${crypto.randomUUID()}@example.com>`,
			subject: 'an attachment too large to archive',
			senderAddress,
			receivedAt: new Date('2026-08-01T09:00:00.000Z'),
			skipReason: 'oversized',
			messageSize: 30_000_000
		},
		tx
	);
	if (!row) throw new Error('insertOversizedThread: onConflictDoNothing swallowed the insert');
	return row;
}

test('reattributeKnownSenders clears skip_reason, claims the contract and its document, and returns 1 (#388)', async () => {
	const result = await inRolledBackTransaction(async (tx) => {
		const documentRow = await insertUnclaimedDocument(tx);
		const threadRow = await insertUnknownSenderThread(tx, documentRow.id, 'leo@visumlabs.example');

		// The contact did not exist when the message arrived — it is added
		// only now, which is the exact shape #388 exists for.
		const { contractIds } = await insertClientWithContract(tx, 'leo@visumlabs.example');

		const recovered = await reattributeKnownSenders(tx);

		const [updatedThread] = await tx
			.select()
			.from(inboundThread)
			.where(eq(inboundThread.id, threadRow.id));
		const [updatedDocument] = await tx
			.select()
			.from(document)
			.where(eq(document.id, documentRow.id));
		const queued = await listInboundThreadsAwaitingExtraction(500, tx);

		return { recovered, updatedThread, updatedDocument, contractIds, queued };
	});

	expect(result.recovered).toBeGreaterThanOrEqual(1);
	expect(result.updatedThread.skipReason).toBeNull();
	expect(result.updatedThread.contractId).toBe(result.contractIds[0]);
	// The thread and its archived document move together (#86's claim path):
	// `claimDocumentForContract` sets all three together.
	expect(result.updatedDocument.contractId).toBe(result.contractIds[0]);
	expect(result.updatedDocument.ownerType).toBe('contract');
	expect(result.updatedDocument.ownerId).toBe(result.contractIds[0]);
	expect(result.queued.map((row) => row.id)).toContain(result.updatedThread.id);
});

test('a row whose document is already claimed is skipped without stopping the rest (#394)', async () => {
	// The bug this defends, found by running the pass against real seeded
	// data rather than by reading it. `document_forbid_retrofit` allows a
	// document's `contract_id` to move exactly once, from null, and rejects
	// a re-point - correctly, since a claimed document is evidence somebody
	// already decided what it belongs to. Accepting a first-intake contract
	// proposal claims the archived message it rests on (#86) while its
	// thread row keeps `sender_unknown`, so that shape is reachable, and
	// before this fix the guard fired, the transaction threw, and the pass
	// recovered *nothing*: two perfectly recoverable rows were left behind
	// because one unrelated row was already claimed.
	const result = await inRolledBackTransaction(async (tx) => {
		const { contractIds } = await insertClientWithContract(tx, 'leo@visumlabs.example');
		const otherClient = await insertClientWithContract(tx, 'someone.else@example.com');

		// Claimed by a different contract than the sender resolves to.
		const claimedDocument = await insertUnclaimedDocument(tx);
		await tx
			.update(document)
			.set({
				contractId: otherClient.contractIds[0],
				ownerType: 'contract',
				ownerId: otherClient.contractIds[0]
			})
			.where(eq(document.id, claimedDocument.id));
		const blocked = await insertUnknownSenderThread(
			tx,
			claimedDocument.id,
			'leo@visumlabs.example'
		);

		// And an ordinary recoverable one beside it, which must still move.
		const freeDocument = await insertUnclaimedDocument(tx);
		const recoverable = await insertUnknownSenderThread(
			tx,
			freeDocument.id,
			'leo@visumlabs.example'
		);

		const recovered = await reattributeKnownSenders(tx);
		const [blockedRow] = await tx
			.select()
			.from(inboundThread)
			.where(eq(inboundThread.id, blocked.id));
		const [recoveredRow] = await tx
			.select()
			.from(inboundThread)
			.where(eq(inboundThread.id, recoverable.id));
		const [untouchedDocument] = await tx
			.select()
			.from(document)
			.where(eq(document.id, claimedDocument.id));
		return { recovered, blockedRow, recoveredRow, untouchedDocument, contractIds, otherClient };
	});

	// The recoverable row moved, so one row's refusal did not stop the batch.
	expect(result.recovered).toBeGreaterThanOrEqual(1);
	expect(result.recoveredRow.skipReason).toBeNull();
	expect(result.recoveredRow.contractId).toBe(result.contractIds[0]);
	// The blocked one is exactly as it was, and its document still belongs
	// to whoever claimed it.
	expect(result.blockedRow.skipReason).toBe('sender_unknown');
	expect(result.blockedRow.contractId).toBeNull();
	expect(result.untouchedDocument.contractId).toBe(result.otherClient.contractIds[0]);
});

test('a document already claimed by the very contract the sender resolves to still recovers (#394)', async () => {
	// Nothing is in conflict here: the document belongs to exactly the
	// contract this sender attributes to, so there is no claim left to make
	// and the thread should simply move. Measured while writing this:
	// `document_forbid_retrofit` *does* tolerate re-pointing a document to
	// the contract it already has, so this passes with or without the
	// `documentContractId` check in `reattributeKnownSenders`. It is here
	// for the behaviour, not to pin one mechanism: whichever way the code
	// gets there, a message whose document is already correctly owned must
	// not be the one shape that stays unreadable.
	const result = await inRolledBackTransaction(async (tx) => {
		const { contractIds } = await insertClientWithContract(tx, 'leo@visumlabs.example');
		const documentRow = await insertUnclaimedDocument(tx);
		await tx
			.update(document)
			.set({
				contractId: contractIds[0],
				ownerType: 'contract',
				ownerId: contractIds[0]
			})
			.where(eq(document.id, documentRow.id));
		const threadRow = await insertUnknownSenderThread(tx, documentRow.id, 'leo@visumlabs.example');

		const recovered = await reattributeKnownSenders(tx);
		const [updated] = await tx
			.select()
			.from(inboundThread)
			.where(eq(inboundThread.id, threadRow.id));
		return { recovered, updated, contractIds };
	});

	expect(result.recovered).toBeGreaterThanOrEqual(1);
	expect(result.updated.skipReason).toBeNull();
	expect(result.updated.contractId).toBe(result.contractIds[0]);
});

test('an address matching a client with two active contracts stays sender_unknown, and reattributeKnownSenders returns 0 (#388)', async () => {
	// The same conservative rule `attributeBySender` already enforces at
	// first arrival: a retainer plus a project on one client is a real
	// shape, and picking one contract for it would be a guess presented as
	// a fact. This is the test that stops someone "improving" reattribution
	// to pick the newer, or the first, contract instead of refusing.
	const result = await inRolledBackTransaction(async (tx) => {
		const documentRow = await insertUnclaimedDocument(tx);
		const threadRow = await insertUnknownSenderThread(tx, documentRow.id, 'ambiguous@acme.example');
		await insertClientWithContract(tx, 'ambiguous@acme.example', { contracts: 2 });

		const recovered = await reattributeKnownSenders(tx);

		const [updatedThread] = await tx
			.select()
			.from(inboundThread)
			.where(eq(inboundThread.id, threadRow.id));
		const [updatedDocument] = await tx
			.select()
			.from(document)
			.where(eq(document.id, documentRow.id));

		return { recovered, updatedThread, updatedDocument };
	});

	// Deliberately not asserting the exact return value: it counts every row
	// the pass recovered across the whole table, and other test files commit
	// rows of their own, so an absolute number here passes alone and fails in
	// a full run (AGENTS.md: scope every assertion to the ids the test
	// created). What this test is about is the row below.
	expect(result.updatedThread.skipReason).toBe('sender_unknown');
	expect(result.updatedThread.contractId).toBeNull();
	expect(result.updatedDocument.contractId).toBeNull();
	expect(result.updatedDocument.ownerType).toBeNull();
});

test('reattributeKnownSenders never touches an oversized row, even once its sender resolves cleanly', async () => {
	const result = await inRolledBackTransaction(async (tx) => {
		const skippedRow = await insertOversizedThread(tx, 'big-attachment@acme.example');
		await insertClientWithContract(tx, 'big-attachment@acme.example');

		const recovered = await reattributeKnownSenders(tx);

		const [updatedThread] = await tx
			.select()
			.from(inboundThread)
			.where(eq(inboundThread.id, skippedRow.id));

		return { recovered, updatedThread };
	});

	// `reattributeKnownSenders` only ever selects `skip_reason =
	// 'sender_unknown'` rows — an oversized row is a different shape
	// entirely (no document, `archived = false`) and must never be counted
	// or rewritten just because its sender happens to now be known.
	// Deliberately not asserting the exact return value: it counts every row
	// the pass recovered across the whole table, and other test files commit
	// rows of their own, so an absolute number here passes alone and fails in
	// a full run (AGENTS.md: scope every assertion to the ids the test
	// created). What this test is about is the row below.
	expect(result.updatedThread.skipReason).toBe('oversized');
	expect(result.updatedThread.archived).toBe(false);
	expect(result.updatedThread.documentId).toBeNull();
	expect(result.updatedThread.contractId).toBeNull();
});

test('reattributeKnownSenders leaves a row with no sender_address alone, the pre-column state', async () => {
	// A row archived before this column existed (or whose envelope carried
	// no address at all) has `sender_address = null`. The join in
	// `reattributeKnownSenders` is an equality against `client_contact.email`,
	// which never matches null, so this row is invisible to it until a
	// backfill gives it an address — this pins that down rather than
	// assuming the join's null-handling.
	const result = await inRolledBackTransaction(async (tx) => {
		const documentRow = await insertUnclaimedDocument(tx);
		const threadRow = await insertUnknownSenderThread(tx, documentRow.id, null);

		const recovered = await reattributeKnownSenders(tx);

		const [updatedThread] = await tx
			.select()
			.from(inboundThread)
			.where(eq(inboundThread.id, threadRow.id));

		return { recovered, updatedThread };
	});

	// Deliberately not asserting the exact return value: it counts every row
	// the pass recovered across the whole table, and other test files commit
	// rows of their own, so an absolute number here passes alone and fails in
	// a full run (AGENTS.md: scope every assertion to the ids the test
	// created). What this test is about is the row below.
	expect(result.updatedThread.senderAddress).toBeNull();
	expect(result.updatedThread.skipReason).toBe('sender_unknown');
	expect(result.updatedThread.contractId).toBeNull();
});
