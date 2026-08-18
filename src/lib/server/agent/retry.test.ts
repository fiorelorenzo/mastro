// #315: a failed extraction can be retried without touching the
// filesystem. `retryFailedRun` re-enqueues the same document's job from
// its archived original (never from anything the failed attempt itself
// produced), and the completed-job half of the lifecycle is exactly
// `drain.test.ts`'s own — this file proves the seam between "a human
// pressed retry" and "the drain turns a completed job into a proposal"
// the same way that file proves the seam between an upload and a drain.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import { afterAll, afterEach, beforeEach, expect, test } from 'vitest';
import type { DbExecutor } from '$lib/server/db';
import { client as pool } from '$lib/server/db';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import type { ExtractionFailureKind } from '$lib/extraction/failure-kind';
import { MAX_EXTRACTION_ATTEMPTS } from '$lib/extraction/retry-eligibility';
import {
	createExtractionRun,
	failRun,
	getExtractionRunByJobId
} from '$lib/server/repositories/extraction-run';
import { createProposal, listProposalsForDocument } from '$lib/server/repositories/proposal';
import { storeDocument } from '$lib/server/repositories/document';
import {
	listCompletedJobs,
	listPendingJobs,
	markJobDone,
	readPendingJob
} from '$lib/server/runner/queue';
import type { ProposalCandidate } from '$lib/server/runner/types';
import { drainCompletedJobs } from './drain';
import { retryFailedRun } from './retry';

let documentRoot: string;
let queueDir: string;

beforeEach(async () => {
	documentRoot = await mkdtemp(join(tmpdir(), 'mastro-retry-documents-'));
	process.env.DOCUMENT_STORAGE_ROOT = documentRoot;
	queueDir = await mkdtemp(join(tmpdir(), 'mastro-retry-queue-'));
});

afterEach(async () => {
	delete process.env.DOCUMENT_STORAGE_ROOT;
	await rm(documentRoot, { recursive: true, force: true });
	await rm(queueDir, { recursive: true, force: true });
});

afterAll(async () => {
	await pool.end();
});

const CLIENT_LINE = 'tra Retry Contratti S.r.l. e dott.ssa Bianca Neri';

function renderContractPdf(lines: readonly string[]): Promise<Buffer> {
	const doc = new PDFDocument({ size: 'A4', margin: 40 });
	const chunks: Buffer[] = [];
	doc.on('data', (chunk: Buffer) => chunks.push(chunk));
	const done = new Promise<Buffer>((resolve, reject) => {
		doc.on('end', () => resolve(Buffer.concat(chunks)));
		doc.on('error', reject);
	});
	doc.font('Helvetica').fontSize(11);
	for (const line of lines) doc.text(line);
	doc.end();
	return done;
}

function validContractFields(): Record<string, unknown> {
	return {
		client: {
			legalName: 'Retry Contratti S.r.l.',
			taxId: '01234567890',
			vatId: null,
			country: 'IT',
			addressLine1: 'Via Prova 9',
			addressLine2: null,
			addressCity: 'Verona',
			addressPostalCode: '37100',
			addressRegion: null
		},
		contract: {
			title: 'Contratto di Prova per il Retry',
			signedDocumentReference: 'Rep. n. 1/2026',
			startsOn: '2026-03-01',
			endsOn: null,
			renewalType: 'none',
			renewalNoticeDays: null,
			terminationNoticeDays: 30,
			paymentTerms: { kind: 'net', days: 30 },
			invoicingCadence: 'monthly',
			currency: 'EUR',
			taxTreatment: 'IVA ordinaria 22%',
			requiresPriorApproval: true,
			requiresExpensePreAuthorisation: true,
			expensePolicy: { kind: 'reimbursed_at_cost' }
		},
		rateCards: [
			{
				validFrom: '2026-03-01',
				validTo: null,
				kind: 'daily',
				amount: 500,
				unit: 'day',
				allowedFractions: [1],
				minimumHours: null,
				disbursementPeriod: null
			}
		],
		clauseFlags: []
	};
}

/** A first-intake contract document (#86: unclaimed, no contract yet)
 * whose one and only run already failed — the state a retry starts
 * from. Real bytes on disk, not a fake hash: `retryFailedRun` reads the
 * document back with `readDocumentBytes`/`extractPdfText`, the same way
 * the original upload action does. */
async function seedFailedContractRun(
	tx: DbExecutor,
	failureKind: ExtractionFailureKind = 'timed_out',
	bytes?: Buffer
) {
	const pdf =
		bytes ??
		(await renderContractPdf([
			'CONTRATTO DI CONSULENZA PROFESSIONALE',
			CLIENT_LINE,
			'Data: 1 marzo 2026'
		]));
	const documentRow = await storeDocument(
		{
			bytes: pdf,
			mime: 'application/pdf',
			originalName: 'retry-contract.pdf',
			provenance: 'upload',
			contractId: null,
			confidential: true,
			ownerType: null,
			ownerId: null
		},
		tx
	);
	// The first attempt's own queue file is irrelevant here — `failRun`
	// only touches the database, and nothing under test ever reads
	// `pending/`'s first entry back — so this is a bare id, not a real
	// `enqueueJob` call, to keep `queueDir` clean for what each test
	// actually asserts on it.
	const firstJobId = crypto.randomUUID();
	await createExtractionRun(
		{
			jobId: firstJobId,
			documentId: documentRow.id,
			targetType: 'contract',
			enqueuedAt: new Date()
		},
		tx
	);
	await failRun(firstJobId, failureKind, 'a scripted first-attempt failure', tx);
	const run = await getExtractionRunByJobId(firstJobId, tx);
	if (!run) throw new Error('run missing right after failRun');
	return { documentRow, run };
}

test('a retryable failed run can be retried, and completing the new job produces exactly one proposal', async () => {
	const outcome = await inRolledBackTransaction(async (tx) => {
		const { documentRow, run } = await seedFailedContractRun(tx, 'timed_out');

		const retried = await retryFailedRun(run, queueDir, tx);
		if (!retried.ok) throw new Error(`expected ok, got blocked: ${retried.reason}`);

		// The retry itself never writes a proposal — only completing and
		// draining the new job does (invariant 3: this stays the proposal
		// path, nothing here reaches a ledger or proposal row on its own).
		expect(await listProposalsForDocument(documentRow.id, tx)).toHaveLength(0);
		expect(retried.run.status).toBe('queued');
		expect(retried.run.id).not.toBe(run.id);
		expect(retried.run.documentId).toBe(documentRow.id);

		const pendingFilename = `${retried.run.jobId}.json`;
		expect(await listPendingJobs(queueDir)).toEqual([pendingFilename]);
		const pendingJob = await readPendingJob(queueDir, pendingFilename);
		// Rebuilt from the archived PDF, not replayed from the failed
		// attempt's own (irrelevant) request content.
		expect(pendingJob.request.content).toContain(CLIENT_LINE);

		// The runner answers, the same scripted two-step `drain.test.ts`
		// uses for a completed job.
		const candidate: ProposalCandidate = {
			documentId: documentRow.id,
			contractId: null,
			targetType: 'contract',
			proposedFields: validContractFields(),
			excerpt: CLIENT_LINE,
			confidence: 0.9
		};
		await markJobDone(queueDir, pendingFilename, pendingJob, candidate);

		const drained = await drainCompletedJobs(queueDir, tx);
		const proposals = await listProposalsForDocument(documentRow.id, tx);
		const finishedRun = await getExtractionRunByJobId(retried.run.jobId, tx);

		return { drained, proposals, finishedRun };
	});

	expect(outcome.drained).toMatchObject({ applied: 1, skipped: 0, failed: [] });
	expect(outcome.proposals).toHaveLength(1);
	expect(outcome.finishedRun?.status).toBe('applied');
	expect(outcome.finishedRun?.proposalId).toBe(outcome.proposals[0].id);
});

test('write_refused is refused before ever touching the queue — the model already answered', async () => {
	await inRolledBackTransaction(async (tx) => {
		const { run } = await seedFailedContractRun(tx, 'write_refused');

		const retried = await retryFailedRun(run, queueDir, tx);

		expect(retried).toEqual({ ok: false, reason: 'kind_not_retryable' });
		expect(await listPendingJobs(queueDir)).toEqual([]);
		expect(await listCompletedJobs(queueDir)).toEqual([]);
	});
});

test('a source whose bytes cannot be re-read refuses the retry instead of throwing', async () => {
	await inRolledBackTransaction(async (tx) => {
		// Bytes that are not a PDF at all, stored under the mime the
		// contract upload action always writes. `extractPdfText` throws
		// `InvalidPDFException` on them, and before #315's guard that threw
		// straight through the run page's form action as a bare 500 instead
		// of the refusal the page already knows how to render.
		const { run } = await seedFailedContractRun(
			tx,
			'timed_out',
			Buffer.from('this is not a pdf at all', 'utf8')
		);

		const retried = await retryFailedRun(run, queueDir, tx);

		expect(retried).toEqual({ ok: false, reason: 'source_missing' });
		expect(await listPendingJobs(queueDir)).toEqual([]);
	});
});

test('a document that already has a proposal from another attempt refuses a retry rather than duplicating it', async () => {
	await inRolledBackTransaction(async (tx) => {
		const { documentRow, run } = await seedFailedContractRun(tx, 'agent_failed');

		// Stands in for "another attempt already succeeded" — a second run
		// for the same document, applied, that this (still `failed`) run
		// knows nothing about.
		await createProposal(
			{
				documentId: documentRow.id,
				contractId: null,
				targetType: 'contract',
				proposedFields: validContractFields(),
				excerpt: CLIENT_LINE,
				confidence: 0.9
			},
			tx
		);

		const retried = await retryFailedRun(run, queueDir, tx);

		expect(retried).toEqual({ ok: false, reason: 'already_has_proposals' });
		// Refused before ever writing a queue file — no second job racing
		// to produce a second set of proposals.
		expect(await listPendingJobs(queueDir)).toEqual([]);
		expect(await listProposalsForDocument(documentRow.id, tx)).toHaveLength(1);
	});
});

test('the retry bound refuses once a document has already had MAX_EXTRACTION_ATTEMPTS runs', async () => {
	await inRolledBackTransaction(async (tx) => {
		const { documentRow, run } = await seedFailedContractRun(tx, 'timed_out');

		// Two more run rows for the same document, bringing the total to
		// MAX_EXTRACTION_ATTEMPTS — standing in for earlier retries, without
		// needing to actually replay the whole enqueue/complete/drain cycle
		// for each one.
		for (let i = 0; i < MAX_EXTRACTION_ATTEMPTS - 1; i++) {
			await createExtractionRun(
				{
					jobId: crypto.randomUUID(),
					documentId: documentRow.id,
					targetType: 'contract',
					enqueuedAt: new Date()
				},
				tx
			);
		}

		const retried = await retryFailedRun(run, queueDir, tx);

		expect(retried).toEqual({ ok: false, reason: 'attempts_exhausted' });
		expect(await listPendingJobs(queueDir)).toEqual([]);
	});
});
