import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, expect, test } from 'vitest';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { client as pool, db } from '$lib/server/db';
import { client, contract } from '$lib/server/db/schema';
import type { ExpensePolicy, PaymentTerms } from '$lib/server/db/schema/contract';
import { storeDocument } from '$lib/server/repositories/document';
import {
	recordInboundThread,
	type InboundThreadInput
} from '$lib/server/repositories/inbound-thread';
import { createProposal } from '$lib/server/repositories/proposal';
import { listPendingJobs, readPendingJob } from '$lib/server/runner/queue';
import { enqueueDayExtractions } from './enqueue';

// Needs a migrated database: `pnpm db:up && pnpm db:migrate`. Postgres work
// happens inside a transaction that is always rolled back, same pattern as
// `repositories/inbound-thread.test.ts`. `enqueueDayExtractions` writes
// real files to `queueDir` via `enqueueJob`, which cannot be rolled back
// with the database, so `queueDir` is a throwaway temp directory removed
// in `afterEach`, same as the document store root.

let documentRoot: string;
let queueDir: string;

beforeEach(async () => {
	documentRoot = await mkdtemp(join(tmpdir(), 'mastro-enqueue-documents-'));
	process.env.DOCUMENT_STORAGE_ROOT = documentRoot;
	queueDir = await mkdtemp(join(tmpdir(), 'mastro-enqueue-queue-'));
});

afterEach(async () => {
	delete process.env.DOCUMENT_STORAGE_ROOT;
	await rm(documentRoot, { recursive: true, force: true });
	await rm(queueDir, { recursive: true, force: true });
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
	contractId: string,
	body = 'ok for Monday'
) {
	return storeDocument(
		{
			bytes: new TextEncoder().encode(`From: ops@client.example\r\n\r\n${body}`),
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
		senderAddress: null,
		receivedAt: new Date('2026-08-01T09:00:00.000Z'),
		...overrides
	};
}

test('enqueueDayExtractions bounds the batch to limit, oldest thread first', async () => {
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

		const outcome = await enqueueDayExtractions(queueDir, 2, tx);
		expect(outcome).toEqual({ enqueued: 2, alreadyProposed: 0 });

		const pending = await listPendingJobs(queueDir);
		expect(pending).toHaveLength(2);
		const jobs = await Promise.all(pending.map((filename) => readPendingJob(queueDir, filename)));
		expect(jobs.map((job) => job.request.documentId).sort()).toEqual(
			[documentA.id, documentB.id].sort()
		);
	});
});

test('enqueueDayExtractions never enqueues a second job for a document that already has a proposal, even when its thread is the oldest and would otherwise be picked first', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const alreadyExtracted = await archiveMessage(tx, contractRow.id, 'ok for last week');
		const stillAwaiting = await archiveMessage(tx, contractRow.id, 'ok for this week');

		await recordInboundThread(
			threadInput(contractRow.id, alreadyExtracted.id, {
				imapUid: 1,
				messageId: null,
				receivedAt: new Date('2026-08-01T09:00:00.000Z')
			}),
			tx
		);
		await recordInboundThread(
			threadInput(contractRow.id, stillAwaiting.id, {
				imapUid: 2,
				messageId: null,
				receivedAt: new Date('2026-08-02T09:00:00.000Z')
			}),
			tx
		);

		// A prior tick already turned this message into a proposal.
		await createProposal(
			{
				documentId: alreadyExtracted.id,
				contractId: contractRow.id,
				targetType: 'work_unit',
				proposedFields: { date: '2026-08-01', quantity: 1, scope: 'last week' },
				excerpt: 'ok for last week',
				confidence: 0.9
			},
			tx
		);

		// A limit generous enough to cover both threads if the guard did not
		// hold: if the older, already-proposed message were ever re-offered,
		// this call would enqueue it too.
		const outcome = await enqueueDayExtractions(queueDir, 10, tx);
		expect(outcome.enqueued).toBe(1);

		const pending = await listPendingJobs(queueDir);
		expect(pending).toHaveLength(1);
		const [job] = await Promise.all(pending.map((filename) => readPendingJob(queueDir, filename)));
		expect(job.request.documentId).toBe(stillAwaiting.id);
	});
});
