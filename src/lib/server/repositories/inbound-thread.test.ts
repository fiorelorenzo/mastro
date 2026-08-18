import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, expect, test } from 'vitest';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { client as pool, db } from '$lib/server/db';
import { client, contract } from '$lib/server/db/schema';
import type { ExpensePolicy, PaymentTerms } from '$lib/server/db/schema/contract';
import { storeDocument } from './document';
import { createProposal } from './proposal';
import {
	findByContractAndMessageId,
	getInboundThreadsForDocuments,
	listInboundThreadsAwaitingExtraction,
	listInboundThreadsForContract,
	maxImapUidForContract,
	recordInboundThread,
	type InboundThreadInput
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
		receivedAt: new Date('2026-08-01T09:00:00.000Z'),
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

test('maxImapUidForContract is scoped per UIDVALIDITY generation, null for a generation never seen', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const documentRow = await archiveMessage(tx, contractRow.id);

		expect(await maxImapUidForContract(contractRow.id, 1700000000, tx)).toBeNull();

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
		expect(await maxImapUidForContract(contractRow.id, 1700000000, tx)).toBe(9);

		// A UIDVALIDITY bump starts a fresh generation: the old
		// generation's high UID must not leak into the new one.
		expect(await maxImapUidForContract(contractRow.id, 1800000000, tx)).toBeNull();
	});
});

test('findByContractAndMessageId finds a thread regardless of which UIDVALIDITY generation recorded it', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const documentRow = await archiveMessage(tx, contractRow.id);
		const messageId = '<same-message@example.com>';

		expect(await findByContractAndMessageId(contractRow.id, messageId, tx)).toBeNull();

		await recordInboundThread(
			threadInput(contractRow.id, documentRow.id, {
				messageId,
				imapUid: 1,
				imapUidValidity: 1700000000
			}),
			tx
		);

		const found = await findByContractAndMessageId(contractRow.id, messageId, tx);
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
