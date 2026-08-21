import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, expect, test } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { rejection } from '$lib/server/db/pg-error';
import { client as pool, db } from '$lib/server/db';
import { client, clientContact, contract } from '$lib/server/db/schema';
import type { ExpensePolicy, PaymentTerms } from '$lib/server/db/schema/contract';
import { normaliseAddress } from '../mail/attribute';
import { parseMessage } from '../mail/headers';
import { readDocumentBytes, storeDocument } from './document';
import { createProposal } from './proposal';
import {
	findByMailboxAndMessageId,
	getInboundThreadForDocument,
	getInboundThreadsForDocuments,
	listInboundThreadsAwaitingExtraction,
	listInboundThreadsForContract,
	listInboundThreadsMissingSenderAddress,
	listSkippedInboundThreadsForContract,
	listUnknownSenderAddresses,
	loadConversations,
	maxImapUidForMailbox,
	recordInboundThread,
	recordSkippedInboundThread,
	setInboundThreadSenderAddress,
	type InboundThreadInput,
	type InboundThreadSkipInput
} from './inbound-thread';

// Needs a migrated database: `pnpm db:up && pnpm db:migrate`. Same
// rolled-back-transaction pattern as `document-mirror.test.ts`, plus a
// throwaway document store root for `storeDocument`'s real filesystem
// writes. `mail/poll.test.ts` covers the same functions composed against
// a real GreenMail mailbox; this file proves each query in isolation.

let root: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'mastro-inbound-thread-'));
	process.env.DOCUMENT_STORAGE_ROOT = root;
});

afterEach(async () => {
	delete process.env.DOCUMENT_STORAGE_ROOT;
	await rm(root, { recursive: true, force: true });
});

afterAll(async () => {
	await pool.end();
});

async function insertContract(tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) {
	const [clientRow] = await tx
		.insert(client)
		.values({
			legalName: `Test Client ${crypto.randomUUID()}`,
			taxId: `TEST-TAX-${crypto.randomUUID()}`,
			country: 'IT',
			addressLine1: 'Via Roma 1',
			addressCity: 'Milano',
			addressPostalCode: '20100',
			noticeChannel: 'email' as const
		})
		.returning();
	const [contractRow] = await tx
		.insert(contract)
		.values({
			clientId: clientRow.id,
			title: 'Test contract',
			startsOn: '2024-01-01',
			renewalType: 'none' as const,
			terminationNoticeDays: 30,
			paymentTerms: { kind: 'net', days: 30 } satisfies PaymentTerms,
			invoicingCadence: 'monthly' as const,
			currency: 'EUR',
			taxTreatment: 'generic',
			expensePolicy: { kind: 'not_reimbursed' } satisfies ExpensePolicy
		})
		.returning();
	return contractRow;
}

async function archiveMessage(
	tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
	contractId: string
) {
	return storeDocument(
		{
			bytes: new TextEncoder().encode(`Subject: test\r\n\r\nbody ${crypto.randomUUID()}`),
			mime: 'message/rfc822',
			originalName: 'thread.eml',
			provenance: 'mail',
			contractId,
			confidential: true,
			ownerType: 'contract',
			ownerId: contractId
		},
		tx
	);
}

function threadInput(
	contractId: string,
	documentId: string,
	overrides: Partial<InboundThreadInput> = {}
): InboundThreadInput {
	return {
		contractId,
		documentId,
		mailbox: 'Acme Corp',
		imapUidValidity: 1700000000,
		imapUid: 1,
		messageId: `<${crypto.randomUUID()}@example.com>`,
		subject: 'Re: approval for next week',
		inReplyTo: null,
		senderAddress: null,
		receivedAt: new Date('2026-08-01T09:00:00.000Z'),
		...overrides
	};
}

function skippedInput(
	contractId: string,
	overrides: Partial<InboundThreadSkipInput> = {}
): InboundThreadSkipInput {
	return {
		contractId,
		mailbox: 'Acme Corp',
		imapUidValidity: 1700000000,
		imapUid: 1,
		messageId: `<${crypto.randomUUID()}@example.com>`,
		subject: 'A message too large to archive',
		inReplyTo: null,
		senderAddress: null,
		receivedAt: new Date('2026-08-01T09:00:00.000Z'),
		skipReason: 'oversized',
		messageSize: 42_000_000,
		...overrides
	};
}

test('recordInboundThread inserts the row and returns it', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const documentRow = await archiveMessage(tx, contractRow.id);

		const row = await recordInboundThread(threadInput(contractRow.id, documentRow.id), tx);
		expect(row).not.toBeNull();
		expect(row?.contractId).toBe(contractRow.id);
		expect(row?.documentId).toBe(documentRow.id);
	});
});

test("recordInboundThread returns null instead of throwing on a duplicate UID, the safety net behind the caller's own pre-checks", async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const documentA = await archiveMessage(tx, contractRow.id);
		const documentB = await archiveMessage(tx, contractRow.id);

		await recordInboundThread(
			threadInput(contractRow.id, documentA.id, { imapUid: 7, messageId: null }),
			tx
		);
		const conflicting = await recordInboundThread(
			threadInput(contractRow.id, documentB.id, { imapUid: 7, messageId: null }),
			tx
		);
		expect(conflicting).toBeNull();
	});
});

test('maxImapUidForMailbox is scoped per mailbox and UIDVALIDITY generation, null for a generation never seen', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const documentRow = await archiveMessage(tx, contractRow.id);

		expect(await maxImapUidForMailbox('Acme Corp', 1700000000, tx)).toBeNull();

		await recordInboundThread(
			threadInput(contractRow.id, documentRow.id, {
				imapUid: 3,
				imapUidValidity: 1700000000,
				messageId: null
			}),
			tx
		);
		await recordInboundThread(
			threadInput(contractRow.id, documentRow.id, {
				imapUid: 9,
				imapUidValidity: 1700000000,
				messageId: null
			}),
			tx
		);
		expect(await maxImapUidForMailbox('Acme Corp', 1700000000, tx)).toBe(9);

		// A UIDVALIDITY bump starts a fresh generation: the old
		// generation's high UID must not leak into the new one.
		expect(await maxImapUidForMailbox('Acme Corp', 1800000000, tx)).toBeNull();
	});
});

test('findByMailboxAndMessageId finds a thread regardless of which UIDVALIDITY generation recorded it', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const documentRow = await archiveMessage(tx, contractRow.id);
		const messageId = '<same-message@example.com>';

		expect(await findByMailboxAndMessageId('Acme Corp', messageId, tx)).toBeNull();

		await recordInboundThread(
			threadInput(contractRow.id, documentRow.id, {
				messageId,
				imapUid: 1,
				imapUidValidity: 1700000000
			}),
			tx
		);

		const found = await findByMailboxAndMessageId('Acme Corp', messageId, tx);
		expect(found?.imapUidValidity).toBe(1700000000);
	});
});

test("listInboundThreadsForContract returns only this contract's threads, newest received first", async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractA = await insertContract(tx);
		const contractB = await insertContract(tx);
		const documentA = await archiveMessage(tx, contractA.id);
		const documentB = await archiveMessage(tx, contractB.id);

		await recordInboundThread(
			threadInput(contractA.id, documentA.id, {
				imapUid: 1,
				messageId: null,
				receivedAt: new Date('2026-08-01T09:00:00.000Z')
			}),
			tx
		);
		await recordInboundThread(
			threadInput(contractA.id, documentA.id, {
				imapUid: 2,
				messageId: null,
				receivedAt: new Date('2026-08-02T09:00:00.000Z')
			}),
			tx
		);
		await recordInboundThread(
			threadInput(contractB.id, documentB.id, { imapUid: 1, messageId: null }),
			tx
		);

		const rows = await listInboundThreadsForContract(contractA.id, tx);
		expect(rows).toHaveLength(2);
		expect(rows[0].imapUid).toBe(2);
		expect(rows[1].imapUid).toBe(1);
	});
});

test('getInboundThreadsForDocuments returns one thread per requested document, and nothing for a document never archived as mail or asked for', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const documentA = await archiveMessage(tx, contractRow.id);
		const documentB = await archiveMessage(tx, contractRow.id);
		const documentC = await archiveMessage(tx, contractRow.id);

		await recordInboundThread(
			threadInput(contractRow.id, documentA.id, { imapUid: 1, messageId: null }),
			tx
		);
		await recordInboundThread(
			threadInput(contractRow.id, documentB.id, { imapUid: 2, messageId: null }),
			tx
		);
		// documentC is archived but never handed off as a thread — the batch
		// call for it is exactly the "no row" case a lone `getInboundThreadForDocument`
		// already returns null for.

		const rows = await getInboundThreadsForDocuments(
			[documentA.id, documentB.id, documentC.id],
			tx
		);
		expect(rows.map((row) => row.documentId).sort()).toEqual([documentA.id, documentB.id].sort());

		expect(await getInboundThreadsForDocuments([], tx)).toEqual([]);
	});
});

test('listInboundThreadsAwaitingExtraction bounds to limit, oldest received first', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const documentA = await archiveMessage(tx, contractRow.id);
		const documentB = await archiveMessage(tx, contractRow.id);
		const documentC = await archiveMessage(tx, contractRow.id);

		await recordInboundThread(
			threadInput(contractRow.id, documentC.id, {
				imapUid: 1,
				messageId: null,
				receivedAt: new Date('2026-08-03T09:00:00.000Z')
			}),
			tx
		);
		await recordInboundThread(
			threadInput(contractRow.id, documentA.id, {
				imapUid: 2,
				messageId: null,
				receivedAt: new Date('2026-08-01T09:00:00.000Z')
			}),
			tx
		);
		await recordInboundThread(
			threadInput(contractRow.id, documentB.id, {
				imapUid: 3,
				messageId: null,
				receivedAt: new Date('2026-08-02T09:00:00.000Z')
			}),
			tx
		);

		const bounded = await listInboundThreadsAwaitingExtraction(2, tx);
		expect(bounded.map((row) => row.documentId)).toEqual([documentA.id, documentB.id]);
	});
});

test('listInboundThreadsAwaitingExtraction excludes a document that already has a proposal, so the next call surfaces the next messages instead of the same ones', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const documentA = await archiveMessage(tx, contractRow.id);
		const documentB = await archiveMessage(tx, contractRow.id);
		const documentC = await archiveMessage(tx, contractRow.id);

		await recordInboundThread(
			threadInput(contractRow.id, documentA.id, {
				imapUid: 1,
				messageId: null,
				receivedAt: new Date('2026-08-01T09:00:00.000Z')
			}),
			tx
		);
		await recordInboundThread(
			threadInput(contractRow.id, documentB.id, {
				imapUid: 2,
				messageId: null,
				receivedAt: new Date('2026-08-02T09:00:00.000Z')
			}),
			tx
		);
		await recordInboundThread(
			threadInput(contractRow.id, documentC.id, {
				imapUid: 3,
				messageId: null,
				receivedAt: new Date('2026-08-03T09:00:00.000Z')
			}),
			tx
		);

		const firstTick = await listInboundThreadsAwaitingExtraction(2, tx);
		expect(firstTick.map((row) => row.documentId)).toEqual([documentA.id, documentB.id]);

		// Simulates the drain (`/api/agent/run` always drains before it
		// enqueues) having already turned documentA's job into a proposal
		// by the next tick.
		await createProposal(
			{
				documentId: documentA.id,
				contractId: contractRow.id,
				targetType: 'work_unit',
				proposedFields: { date: '2026-08-01', quantity: 1, scope: 'test' },
				excerpt: 'ok',
				confidence: 0.9
			},
			tx
		);

		const secondTick = await listInboundThreadsAwaitingExtraction(2, tx);
		expect(secondTick.map((row) => row.documentId)).toEqual([documentB.id, documentC.id]);
	});
});

test('recordSkippedInboundThread inserts a row with no document, returns it, and never reaches listInboundThreadsAwaitingExtraction', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const documentA = await archiveMessage(tx, contractRow.id);

		await recordInboundThread(
			threadInput(contractRow.id, documentA.id, { imapUid: 1, messageId: null }),
			tx
		);
		const skipped = await recordSkippedInboundThread(
			skippedInput(contractRow.id, { imapUid: 2, messageId: null }),
			tx
		);

		expect(skipped).not.toBeNull();
		expect(skipped?.documentId).toBeNull();
		expect(skipped?.skipReason).toBe('oversized');
		expect(skipped?.messageSize).toBe(42_000_000);

		// The extraction enqueuer has nothing to extract from a skipped
		// message — no document, no bytes — so it must never see this row,
		// only the one that was actually archived. Asserted as membership
		// rather than equality: this query is table-wide, and the mail poll
		// tests write real, committed threads of their own in parallel with
		// this file, so the exact list is not this test's to predict.
		const awaitingExtraction = await listInboundThreadsAwaitingExtraction(50, tx);
		const documentIds = awaitingExtraction.map((row) => row.documentId);
		expect(documentIds).toContain(documentA.id);
		expect(awaitingExtraction.map((row) => row.id)).not.toContain(skipped?.id);
	});
});

test('recordSkippedInboundThread returns null instead of throwing on a duplicate UID, the same safety net recordInboundThread has', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);

		await recordSkippedInboundThread(
			skippedInput(contractRow.id, { imapUid: 7, messageId: null }),
			tx
		);
		const conflicting = await recordSkippedInboundThread(
			skippedInput(contractRow.id, { imapUid: 7, messageId: null }),
			tx
		);
		expect(conflicting).toBeNull();
	});
});

test("listSkippedInboundThreadsForContract returns only this contract's skipped threads, newest received first, never an archived one", async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractA = await insertContract(tx);
		const contractB = await insertContract(tx);
		const documentA = await archiveMessage(tx, contractA.id);

		await recordInboundThread(
			threadInput(contractA.id, documentA.id, { imapUid: 1, messageId: null }),
			tx
		);
		await recordSkippedInboundThread(
			skippedInput(contractA.id, {
				imapUid: 2,
				messageId: null,
				receivedAt: new Date('2026-08-01T09:00:00.000Z')
			}),
			tx
		);
		await recordSkippedInboundThread(
			skippedInput(contractA.id, {
				imapUid: 3,
				messageId: null,
				receivedAt: new Date('2026-08-02T09:00:00.000Z')
			}),
			tx
		);
		await recordSkippedInboundThread(
			skippedInput(contractB.id, { imapUid: 1, messageId: null }),
			tx
		);

		const rows = await listSkippedInboundThreadsForContract(contractA.id, 10, tx);
		expect(rows.every((row) => row.archived === false)).toBe(true);
		expect(rows.map((row) => row.imapUid)).toEqual([3, 2]);
	});
});

// #380: watching a whole mailbox archives every message, and extraction
// costs a model call each, so a message whose sender nobody knows is kept
// and never queued. This is the guard, at the one query the drain reads.
test('a thread archived with an unknown sender is never queued for extraction', async () => {
	const result = await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const knownDocument = await archiveMessage(tx, contractRow.id);
		const known = await recordInboundThread(
			threadInput(contractRow.id, knownDocument.id, { imapUid: 41 }),
			tx
		);

		const unknownDocument = await archiveMessage(tx, contractRow.id);
		const unknown = await recordInboundThread(
			{
				...threadInput(contractRow.id, unknownDocument.id, { imapUid: 42, messageId: null }),
				contractId: null,
				skipReason: 'sender_unknown' as const
			},
			tx
		);

		const queued = await listInboundThreadsAwaitingExtraction(500, tx);
		return { known, unknown, queuedIds: queued.map((row) => row.id) };
	});

	// Scoped to the rows this test made: the seeded instance has its own.
	expect(result.queuedIds).toContain(result.known?.id);
	expect(result.queuedIds).not.toContain(result.unknown?.id);
	// The bytes are still there. Nothing was discarded to save the call.
	expect(result.unknown?.documentId).not.toBeNull();
	expect(result.unknown?.archived).toBe(true);
	expect(result.unknown?.contractId).toBeNull();
});

// #394: the backfill (`scripts/backfill-sender-address.ts`) for every
// `inbound_thread` row written before `sender_address` existed. These
// cover the two repository functions it is built from; the script itself
// is a thin `node --env-file-if-exists` entrypoint in the same shape as
// `scripts/seed-demo.ts`, run directly rather than imported by a test.

test('listInboundThreadsMissingSenderAddress returns a null-sender row with its document hash, and excludes one that already has an address', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);

		const missingDocument = await archiveMessage(tx, contractRow.id);
		const missing = await recordInboundThread(
			threadInput(contractRow.id, missingDocument.id, { imapUid: 1, messageId: null }),
			tx
		);

		const knownDocument = await archiveMessage(tx, contractRow.id);
		const known = await recordInboundThread(
			threadInput(contractRow.id, knownDocument.id, {
				imapUid: 2,
				messageId: null,
				senderAddress: 'known@example.com'
			}),
			tx
		);

		const rows = await listInboundThreadsMissingSenderAddress(tx);
		const byId = new Map(rows.map((row) => [row.id, row]));

		expect(byId.get(missing!.id)).toEqual({
			id: missing!.id,
			documentId: missingDocument.id,
			documentHash: missingDocument.hash
		});
		expect(byId.has(known!.id)).toBe(false);
	});
});

test('a skipped message has no document to read, and the query reports a null hash rather than omitting it', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const skipped = await recordSkippedInboundThread(
			skippedInput(contractRow.id, { imapUid: 9, messageId: null }),
			tx
		);

		const rows = await listInboundThreadsMissingSenderAddress(tx);
		expect(rows.find((row) => row.id === skipped!.id)).toEqual({
			id: skipped!.id,
			documentId: null,
			documentHash: null
		});
	});
});

test('setInboundThreadSenderAddress writes the address, and the row leaves the missing set', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const documentRow = await archiveMessage(tx, contractRow.id);
		const thread = await recordInboundThread(
			threadInput(contractRow.id, documentRow.id, { imapUid: 3, messageId: null }),
			tx
		);

		await setInboundThreadSenderAddress(thread!.id, 'leo@visumlabs.example', tx);

		const refreshed = await getInboundThreadForDocument(documentRow.id, tx);
		expect(refreshed?.senderAddress).toBe('leo@visumlabs.example');

		const stillMissing = await listInboundThreadsMissingSenderAddress(tx);
		expect(stillMissing.map((row) => row.id)).not.toContain(thread!.id);
	});
});

// The script reads real bytes off disk and has to cope with a `From`
// header folded across a continuation line — a long display name genuinely
// does this. `parseMessage` already unfolds it (`mail/headers.test.ts`);
// this proves the whole chain the script actually runs — archived bytes,
// through `parseMessage`, through `normaliseAddress`, into the row — comes
// out the same address a bare envelope would have given it.
test('the backfill chain recovers a folded From header from an archived document', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const raw = Buffer.from(
			'From: Leonardo Bianchi\r\n' +
				' <leo@visumlabs.example>\r\n' +
				'Subject: giornate agosto\r\n' +
				'\r\n' +
				'corpo del messaggio\r\n'
		);
		const documentRow = await storeDocument(
			{
				bytes: raw,
				mime: 'message/rfc822',
				originalName: 'thread.eml',
				provenance: 'mail',
				contractId: contractRow.id,
				confidential: true,
				ownerType: 'contract',
				ownerId: contractRow.id
			},
			tx
		);
		const thread = await recordInboundThread(
			threadInput(contractRow.id, documentRow.id, { imapUid: 5, messageId: null }),
			tx
		);

		const [candidate] = (await listInboundThreadsMissingSenderAddress(tx)).filter(
			(row) => row.id === thread!.id
		);
		expect(candidate.documentHash).toBe(documentRow.hash);

		const bytesBackOffDisk = await readDocumentBytes({ hash: candidate.documentHash! });
		const { headers } = parseMessage(bytesBackOffDisk);
		const address = normaliseAddress(headers.get('from') ?? null);
		expect(address).toBe('leo@visumlabs.example');

		await setInboundThreadSenderAddress(thread!.id, address!, tx);
		const refreshed = await getInboundThreadForDocument(documentRow.id, tx);
		expect(refreshed?.senderAddress).toBe('leo@visumlabs.example');
	});
});

// #394: the panel `/mail` shows a human every sender the poll refused
// because it matched no contact — the diagnostic that would have surfaced
// `leo@visumlabs.com` sitting unread next to a contact recorded as
// `leonardo@visumlabs.com`.
test('listUnknownSenderAddresses groups refused senders by address, most recent message first, with the latest subject per group', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const leo = `leo-${crypto.randomUUID()}@visumlabs.example`;
		const known = `known-${crypto.randomUUID()}@example.com`;

		async function unknownSenderRow(overrides: Partial<InboundThreadInput>) {
			const document = await archiveMessage(tx, contractRow.id);
			return recordInboundThread(
				{
					...threadInput(contractRow.id, document.id, { messageId: null, ...overrides }),
					contractId: null,
					skipReason: 'sender_unknown' as const
				},
				tx
			);
		}

		await unknownSenderRow({
			imapUid: 1,
			senderAddress: leo,
			subject: 'first message',
			receivedAt: new Date('2026-08-01T09:00:00.000Z')
		});
		await unknownSenderRow({
			imapUid: 2,
			senderAddress: leo,
			subject: 'second message',
			receivedAt: new Date('2026-08-05T09:00:00.000Z')
		});
		await unknownSenderRow({
			imapUid: 3,
			senderAddress: null,
			subject: 'no sender header',
			receivedAt: new Date('2026-08-03T09:00:00.000Z')
		});

		// A known-sender hand-off (default skipReason null) must not appear:
		// this panel is only for what the poll refused to attribute.
		const knownDocument = await archiveMessage(tx, contractRow.id);
		await recordInboundThread(
			threadInput(contractRow.id, knownDocument.id, {
				imapUid: 4,
				messageId: null,
				senderAddress: known
			}),
			tx
		);

		const rows = await listUnknownSenderAddresses(1000, tx);

		const leoRow = rows.find((row) => row.senderAddress === leo);
		expect(leoRow?.messageCount).toBe(2);
		expect(leoRow?.lastSubject).toBe('second message');
		expect(leoRow?.lastReceivedAt.toISOString()).toBe('2026-08-05T09:00:00.000Z');

		const unreadableRow = rows.find((row) => row.senderAddress === null);
		expect(unreadableRow?.messageCount).toBeGreaterThanOrEqual(1);

		expect(rows.some((row) => row.senderAddress === known)).toBe(false);

		// leo has two messages against the null group's one, and neither
		// address shares a domain with any contact here, so volume is what
		// separates them. Not recency: that was the original ordering and it
		// was wrong (see the ordering test below).
		const leoIndex = rows.findIndex((row) => row.senderAddress === leo);
		const unreadableIndex = rows.findIndex((row) => row.senderAddress === null);
		expect(leoIndex).toBeLessThan(unreadableIndex);
	});
});

test('an address at a domain some contact already uses sorts first, ahead of a louder and newer stranger (#394)', async () => {
	// The defect this defends was invisible until the panel met a real
	// mailbox: 133 distinct addresses had written to it, and the one that
	// mattered - a client's, differing from the recorded contact only by
	// `leo@` against `leonardo@` - ranked 57th by recency, outside the
	// panel's own limit. The diagnostic built to surface that address would
	// not have surfaced it. So a shared domain outranks both volume and
	// recency, and this test pins it by making the stranger win on both.
	const result = await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const domain = `visumlabs-${crypto.randomUUID().slice(0, 8)}.example`;
		const recordedContact = `leonardo@${domain}`;
		const actualSender = `leo@${domain}`;
		const stranger = `newsletter-${crypto.randomUUID().slice(0, 8)}@stranger.example`;

		const [clientRow] = await tx.select().from(client).where(eq(client.id, contractRow.clientId));
		await tx.insert(clientContact).values({
			clientId: clientRow.id,
			name: 'Leonardo Ubbiali',
			email: recordedContact,
			role: 'CEO'
		});

		async function refused(senderAddress: string, uid: number, receivedAt: Date) {
			const document = await archiveMessage(tx, contractRow.id);
			return recordInboundThread(
				{
					...threadInput(contractRow.id, document.id, {
						messageId: null,
						imapUid: uid,
						senderAddress,
						receivedAt
					}),
					contractId: null,
					skipReason: 'sender_unknown' as const
				},
				tx
			);
		}

		// The client wrote twice, a while ago.
		await refused(actualSender, 101, new Date('2026-08-01T09:00:00.000Z'));
		await refused(actualSender, 102, new Date('2026-08-02T09:00:00.000Z'));
		// The stranger wrote more, and more recently - it wins on every other
		// axis, which is the point.
		await refused(stranger, 103, new Date('2026-08-20T09:00:00.000Z'));
		await refused(stranger, 104, new Date('2026-08-20T10:00:00.000Z'));
		await refused(stranger, 105, new Date('2026-08-20T11:00:00.000Z'));

		const rows = await listUnknownSenderAddresses(1000, tx);
		return {
			rows,
			actualSender,
			stranger,
			senderIndex: rows.findIndex((row) => row.senderAddress === actualSender),
			strangerIndex: rows.findIndex((row) => row.senderAddress === stranger)
		};
	});

	const sender = result.rows[result.senderIndex];
	const stranger = result.rows[result.strangerIndex];
	expect(sender?.domainKnown).toBe(true);
	expect(stranger?.domainKnown).toBe(false);
	expect(sender?.messageCount).toBe(2);
	expect(stranger?.messageCount).toBe(3);
	// Fewer messages, older, and still first.
	expect(result.senderIndex).toBeLessThan(result.strangerIndex);
});

test('a conversation whose middle message was never archived is still one conversation (#410)', async () => {
	// The real shape of the first approval on this ledger. Leo offers, I
	// answer, Leo says thanks - and my answer is outbound, so nothing
	// archives it (#409). The mailbox holds the first and the third with a
	// hole between them, and `in_reply_to` alone cannot bridge it: the third
	// names my answer, which is not a row here. Its `References` names the
	// offer directly, which is what does bridge it.
	const conversations = await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const offerId = `<offer-${crypto.randomUUID()}@visumlabs.example>`;
		const mineId = `<mine-${crypto.randomUUID()}@gmail.example>`;
		const thanksId = `<thanks-${crypto.randomUUID()}@visumlabs.example>`;

		const offerDocument = await archiveMessage(tx, contractRow.id);
		const thanksDocument = await archiveMessage(tx, contractRow.id);

		await recordInboundThread(
			threadInput(contractRow.id, offerDocument.id, {
				imapUid: 41,
				messageId: offerId,
				inReplyTo: null,
				referenceIds: [],
				receivedAt: new Date('2026-08-05T16:38:00.000Z')
			}),
			tx
		);
		const thanks = await recordInboundThread(
			threadInput(contractRow.id, thanksDocument.id, {
				imapUid: 42,
				messageId: thanksId,
				// Replies to a message that is not in this table.
				inReplyTo: mineId,
				referenceIds: [offerId, mineId],
				receivedAt: new Date('2026-08-05T16:41:00.000Z')
			}),
			tx
		);

		// Seeded from the reply alone, the way the enqueue pass reaches it.
		return loadConversations([thanks as Parameters<typeof loadConversations>[0][number]], tx);
	});

	expect(conversations).toHaveLength(1);
	expect(conversations[0]).toHaveLength(2);
	// Oldest first: the offer has to arrive at the model before the answer to
	// it, or the answer reads as a statement of its own.
	expect(conversations[0][0].messageId).toContain('offer-');
	expect(conversations[0][1].messageId).toContain('thanks-');
});

test('two threads that merely share a subject stay apart (#410)', async () => {
	// The line `References` must not cross. Widening the walk to a second
	// header kind is safe because both are identifiers; widening it to
	// subjects would merge two unrelated "Re: Conferma" negotiations and
	// judge their days as one exchange.
	const conversations = await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const firstDocument = await archiveMessage(tx, contractRow.id);
		const secondDocument = await archiveMessage(tx, contractRow.id);

		const first = await recordInboundThread(
			threadInput(contractRow.id, firstDocument.id, {
				imapUid: 51,
				subject: 'Re: Conferma allocazione',
				referenceIds: [`<unrelated-a-${crypto.randomUUID()}@example.com>`],
				receivedAt: new Date('2026-08-06T09:00:00.000Z')
			}),
			tx
		);
		const second = await recordInboundThread(
			threadInput(contractRow.id, secondDocument.id, {
				imapUid: 52,
				subject: 'Re: Conferma allocazione',
				referenceIds: [`<unrelated-b-${crypto.randomUUID()}@example.com>`],
				receivedAt: new Date('2026-08-06T10:00:00.000Z')
			}),
			tx
		);

		return loadConversations([first, second] as Parameters<typeof loadConversations>[0], tx);
	});

	expect(conversations).toHaveLength(2);
	expect(conversations.every((conversation) => conversation.length === 1)).toBe(true);
});

test('a message I sent never seeds an extraction, but does travel in the conversation (#409)', async () => {
	// Invariant 3, in the one place it could quietly break. My own reply has
	// to reach the model - the approval is often mine - but a day resting on
	// nothing but what I wrote would be me approving my own work. So an
	// outbound row is never a seed, and is always part of its conversation.
	const result = await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const offerId = `<offer-${crypto.randomUUID()}@client.example>`;
		const offerDocument = await archiveMessage(tx, contractRow.id);
		const mineDocument = await archiveMessage(tx, contractRow.id);

		const offer = await recordInboundThread(
			threadInput(contractRow.id, offerDocument.id, {
				imapUid: 61,
				messageId: offerId,
				receivedAt: new Date('2026-08-05T16:38:00.000Z')
			}),
			tx
		);
		const mine = await recordInboundThread(
			threadInput(contractRow.id, mineDocument.id, {
				imapUid: 62,
				mailbox: 'Sent',
				messageId: `<mine-${crypto.randomUUID()}@me.example>`,
				inReplyTo: offerId,
				direction: 'outbound',
				receivedAt: new Date('2026-08-05T16:40:00.000Z')
			}),
			tx
		);

		const awaiting = await listInboundThreadsAwaitingExtraction(50, tx);
		const conversations = await loadConversations(
			[offer as Parameters<typeof loadConversations>[0][number]],
			tx
		);
		return { awaiting, conversations, offerId: offer.id, mineId: mine.id };
	});

	// The offer is a seed; my reply is not.
	const seedIds = result.awaiting.map((row) => row.id);
	expect(seedIds).toContain(result.offerId);
	expect(seedIds).not.toContain(result.mineId);

	// And it is in the conversation the offer belongs to, second, because it
	// came second.
	expect(result.conversations).toHaveLength(1);
	expect(result.conversations[0].map((row) => row.id)).toEqual([result.offerId, result.mineId]);
});

test('the database refuses a skip reason that contradicts the direction (#409)', async () => {
	// Both fields are written by one code path whose only difference is the
	// direction, so getting them the wrong way round is the plausible bug:
	// an inbound message refused for an unknown *recipient*, or a message I
	// sent blamed on an unknown *sender*. Neither is a thing that can happen.
	const errors = await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const outboundBlamedOnSender = await rejection(
			() =>
				recordSkippedInboundThread(
					{
						...skippedInput(contractRow.id, { imapUid: 71, direction: 'outbound' }),
						skipReason: 'oversized'
					},
					tx
				).then(() =>
					tx.execute(
						sql`update inbound_thread set skip_reason = 'sender_unknown' where imap_uid = 71`
					)
				),
			tx
		);
		const inboundBlamedOnRecipient = await rejection(
			() =>
				recordSkippedInboundThread(
					{
						...skippedInput(contractRow.id, { imapUid: 72 }),
						skipReason: 'recipient_unknown'
					},
					tx
				),
			tx
		);
		return { outboundBlamedOnSender, inboundBlamedOnRecipient };
	});

	expect(errors.outboundBlamedOnSender.constraint_name).toBe(
		'inbound_thread_skip_reason_matches_direction'
	);
	expect(errors.inboundBlamedOnRecipient.constraint_name).toBe(
		'inbound_thread_skip_reason_matches_direction'
	);
});
