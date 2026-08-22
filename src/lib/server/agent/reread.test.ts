// #404: the human-driven "read this conversation again" action.
// `reReadConversation` enqueues one job for a conversation through the
// same `buildConversationExtractionRequest` builder `enqueueDayExtractions`
// uses (`enqueue.test.ts` proves that builder's own shape), so this file
// proves the two things that are specific to asking again: a second ask
// while the first is still in flight is refused, and it works for a
// conversation whose document has never had an `extraction_run` row at
// all — the corrected finding in #404's own issue thread, where a
// rejected proposal recorded before mailbox extractions tracked runs left
// exactly this shape on the live instance.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, expect, test } from 'vitest';
import type { DbExecutor } from '$lib/server/db';
import { client as pool } from '$lib/server/db';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { client, contract, proposal, workUnit } from '$lib/server/db/schema';
import type { ExpensePolicy, PaymentTerms } from '$lib/server/db/schema/contract';
import { storeDocument } from '$lib/server/repositories/document';
import {
	recordInboundThread,
	type InboundThreadInput
} from '$lib/server/repositories/inbound-thread';
import { rejectProposal } from '$lib/server/repositories/proposal';
import { getExtractionRunByJobId } from '$lib/server/repositories/extraction-run';
import { listPendingJobs, markJobDone, readPendingJob } from '$lib/server/runner/queue';
import type { ProposalCandidate } from '$lib/server/runner/types';
import { drainCompletedJobs } from './drain';
import { nothingProposedDates, reReadConversation } from './reread';

let documentRoot: string;
let queueDir: string;

beforeEach(async () => {
	documentRoot = await mkdtemp(join(tmpdir(), 'mastro-reread-documents-'));
	process.env.DOCUMENT_STORAGE_ROOT = documentRoot;
	queueDir = await mkdtemp(join(tmpdir(), 'mastro-reread-queue-'));
});

afterEach(async () => {
	delete process.env.DOCUMENT_STORAGE_ROOT;
	await rm(documentRoot, { recursive: true, force: true });
	await rm(queueDir, { recursive: true, force: true });
});

afterAll(async () => {
	await pool.end();
});

async function insertContract(tx: DbExecutor) {
	const [clientRow] = await tx
		.insert(client)
		.values({
			legalName: `Reread Client ${crypto.randomUUID()}`,
			taxId: `REREAD-TAX-${crypto.randomUUID()}`,
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
			title: 'Reread contract',
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

async function archiveMessage(tx: DbExecutor, contractId: string, body: string) {
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
		inReplyTo: null,
		senderAddress: null,
		receivedAt: new Date('2026-08-01T09:00:00.000Z'),
		...overrides
	};
}

test('reReadConversation enqueues a job for a document that has never had an extraction_run row, even though it already has a rejected proposal', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const documentRow = await archiveMessage(tx, contractRow.id, 'ok for Monday');
		await recordInboundThread(threadInput(contractRow.id, documentRow.id), tx);

		// The exact shape the issue's own corrected finding measured on the
		// live instance: a rejected proposal, and zero extraction_run rows —
		// `listInboundThreadsAwaitingExtraction`'s own `isNull(proposal.id)`
		// keeps a document like this out of the automatic sweep permanently,
		// which is the whole reason #404 exists as an explicit human action.
		const [rejected] = await tx
			.insert(proposal)
			.values({
				documentId: documentRow.id,
				contractId: contractRow.id,
				targetType: 'work_unit',
				proposedFields: { date: '2026-08-01', quantity: 1, scope: 'Lavoro' },
				excerpt: 'ok for Monday',
				confidence: 0.8,
				status: 'pending'
			})
			.returning();
		await rejectProposal(rejected.id, 'reviewer@example.com', tx);

		const outcome = await reReadConversation(documentRow.id, queueDir, tx);
		if (!outcome.ok) throw new Error(`expected ok, got blocked: ${outcome.reason}`);
		expect(outcome.run.status).toBe('queued');
		expect(outcome.run.documentId).toBe(documentRow.id);
		expect(outcome.run.targetType).toBe('work_unit');

		const pending = await listPendingJobs(queueDir);
		expect(pending).toEqual([`${outcome.run.jobId}.json`]);
		const job = await readPendingJob(queueDir, pending[0]);
		expect(job.request.documentId).toBe(documentRow.id);
		expect(job.request.contractId).toBe(contractRow.id);
		expect(job.request.content).toContain('ok for Monday');

		return outcome;
	});
});

test('asking twice in a row while the first ask is still queued creates no second job, and says why', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);
		const documentRow = await archiveMessage(tx, contractRow.id, 'ok for Tuesday');
		await recordInboundThread(threadInput(contractRow.id, documentRow.id), tx);

		const first = await reReadConversation(documentRow.id, queueDir, tx);
		if (!first.ok) throw new Error(`expected ok, got blocked: ${first.reason}`);

		const second = await reReadConversation(documentRow.id, queueDir, tx);
		expect(second).toEqual({ ok: false, reason: 'in_flight' });

		// One job, not two — the guard refused before ever calling
		// `enqueueJob` a second time.
		const pending = await listPendingJobs(queueDir);
		expect(pending).toEqual([`${first.run.jobId}.json`]);
	});
});

test(
	'a re-read whose only day is already recorded ends nothing_proposed, and the date it skipped is readable back from the run',
	{ timeout: 30_000 },
	async () => {
		const outcome = await inRolledBackTransaction(async (tx) => {
			const contractRow = await insertContract(tx);
			const documentRow = await archiveMessage(
				tx,
				contractRow.id,
				'ok for Monday, all day approved'
			);
			await recordInboundThread(
				threadInput(contractRow.id, documentRow.id, {
					receivedAt: new Date('2026-08-03T09:00:00.000Z')
				}),
				tx
			);
			// The day the re-read's own candidate below will report — already
			// on the ledger before the reading happens, exactly what #403's
			// `alreadyDecided` is meant to catch, and exactly what makes a
			// re-read of a stale rejection the common, non-looping outcome
			// #404 asks for.
			await tx.insert(workUnit).values({
				contractId: contractRow.id,
				date: '2026-08-03',
				quantity: 1,
				scope: 'Lavoro',
				state: 'worked_without_approval'
			});

			const asked = await reReadConversation(documentRow.id, queueDir, tx);
			if (!asked.ok) throw new Error(`expected ok, got blocked: ${asked.reason}`);

			const pendingFilename = `${asked.run.jobId}.json`;
			const pendingJob = await readPendingJob(queueDir, pendingFilename);
			const candidate: ProposalCandidate = {
				documentId: documentRow.id,
				contractId: contractRow.id,
				targetType: 'work_unit',
				proposedFields: {
					days: [
						{
							date: '2026-08-03',
							quantity: 1,
							scope: 'Lavoro',
							excerpt: 'ok for Monday, all day approved',
							messageIndex: 0
						}
					]
				},
				excerpt: 'ok for Monday, all day approved',
				confidence: 0.9
			};
			await markJobDone(queueDir, pendingFilename, pendingJob, candidate);

			const drained = await drainCompletedJobs(queueDir, tx);
			const finishedRun = await getExtractionRunByJobId(asked.run.jobId, tx);
			const skippedDates = finishedRun ? await nothingProposedDates(queueDir, finishedRun) : [];

			return { drained, finishedRun, skippedDates };
		});

		expect(outcome.drained).toMatchObject({ applied: 1, skipped: 0, failed: [] });
		expect(outcome.finishedRun?.status).toBe('nothing_proposed');
		expect(outcome.finishedRun?.proposalId).toBeNull();
		// The date this reading found, all of it already on the ledger — what
		// makes "nothing to review" read as an answer about 2026-08-03
		// specifically, not a shrug.
		expect(outcome.skippedDates).toEqual(['2026-08-03']);
	}
);
