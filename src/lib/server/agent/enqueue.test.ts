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
import {
	createExtractionRun,
	getExtractionRunByJobId
} from '$lib/server/repositories/extraction-run';
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

		// A limit far larger than this test needs, on purpose. The batch is
		// ordered oldest-first and bounded, and a sibling test file working
		// against a real mailbox commits threads of its own, so a tight limit
		// lets those crowd this test's own thread out of the batch entirely -
		// which fails as "the guard dropped it" when nothing of the sort
		// happened. The bound itself has its own test above.
		await enqueueDayExtractions(queueDir, 500, tx);

		// Asserted by document id, not by count. `enqueueDayExtractions` reads
		// every thread awaiting extraction, and a sibling test file working
		// against a real mailbox commits threads of its own, so an absolute
		// number here passes alone and fails in a full run.
		const pending = await listPendingJobs(queueDir);
		const queued = await Promise.all(pending.map((filename) => readPendingJob(queueDir, filename)));
		const queuedDocumentIds = queued.map((job) => job.request.documentId);
		expect(queuedDocumentIds).toContain(stillAwaiting.id);
		expect(queuedDocumentIds).not.toContain(alreadyExtracted.id);
	});
});

test('a message already extracted is never re-queued, even though it produced no proposal (#398)', async () => {
	// The loop this closes, measured on the live instance rather than
	// reasoned about: three newsletters that approve no days produce no
	// proposal, ever, so a guard reading proposals answered "not extracted
	// yet" for them on every pass. `queued 3` on every scheduler tick, five
	// minutes apart, indefinitely, each one paying for a model call to
	// re-learn the same nothing.
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const approvedNothing = await archiveMessage(tx, contractRow.id, 'newsletter, no days here');
		const stillAwaiting = await archiveMessage(tx, contractRow.id, 'ok for this week');

		await recordInboundThread(
			threadInput(contractRow.id, approvedNothing.id, {
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

		// A prior tick extracted it and it proposed nothing: a run exists,
		// no proposal ever will.
		await createExtractionRun(
			{
				jobId: crypto.randomUUID(),
				documentId: approvedNothing.id,
				targetType: 'work_unit',
				enqueuedAt: new Date('2026-08-01T10:00:00.000Z')
			},
			tx
		);

		await enqueueDayExtractions(queueDir, 500, tx);

		// By id, not by count: see the note in the test above.
		const pending = await listPendingJobs(queueDir);
		const queued = await Promise.all(pending.map((filename) => readPendingJob(queueDir, filename)));
		const queuedDocumentIds = queued.map((job) => job.request.documentId);
		expect(queuedDocumentIds).toContain(stillAwaiting.id);
		expect(queuedDocumentIds).not.toContain(approvedNothing.id);
	});
});

test('every job it queues gets an extraction run, so the registry can see it (#398)', async () => {
	// #281's own claim - "every extraction is a run you can watch" - was
	// false for exactly the extractions nobody watches. Only the hand-driven
	// import created a run, so on the live instance the registry held two
	// rows while the mailbox had produced eight jobs, and the registry that
	// exists to make "a failure repeating every five minutes visible" could
	// not see the failure repeating every five minutes.
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const message = await archiveMessage(tx, contractRow.id, 'ok for Monday');
		await recordInboundThread(
			threadInput(contractRow.id, message.id, { imapUid: 1, messageId: null }),
			tx
		);

		await enqueueDayExtractions(queueDir, 500, tx);

		const pending = await listPendingJobs(queueDir);
		const queued = await Promise.all(pending.map((filename) => readPendingJob(queueDir, filename)));
		const job = queued.find((candidate) => candidate.request.documentId === message.id);
		expect(job).toBeDefined();

		// Keyed by the job id the queue actually wrote, which is what ties
		// the three views to the file on disk.
		const run = await getExtractionRunByJobId(job!.id, tx);
		expect(run?.documentId).toBe(message.id);
		expect(run?.status).toBe('queued');
		expect(run?.targetType).toBe('work_unit');
	});
});
