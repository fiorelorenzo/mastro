import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import type { DbExecutor } from '$lib/server/db';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { document } from '$lib/server/db/schema';
import {
	createExtractionRun,
	getExtractionRunByJobId
} from '$lib/server/repositories/extraction-run';
import { listProposalsForDocument } from '$lib/server/repositories/proposal';
import {
	enqueueJob,
	listCompletedJobs,
	markJobDone,
	readPendingJob
} from '$lib/server/runner/queue';
import type { ProposalCandidate } from '$lib/server/runner/types';
import { drainCompletedJobs } from './drain';

/**
 * #278's own lifecycle, layered on the same scripted-model shape
 * `loop.test.ts` and `contract-producer.test.ts` already use for a
 * completed job: a job goes in, the runner's side leaves an answer in
 * `done/`, and this proves what happens to the `extraction_run` row a
 * contract upload creates alongside it — the transitions those two files
 * have no reason to know about. A `'contract'` job is used throughout
 * because it is the one target type that actually gets a run row today
 * (`contracts/+page.server.ts`); a `'work_unit'` job stands in for the
 * "no run row" case precisely because it does not.
 */
async function seedUnclaimedDocument(tx: DbExecutor) {
	const [documentRow] = await tx
		.insert(document)
		.values({
			hash: 'b'.repeat(64),
			mime: 'application/pdf',
			size: 4096,
			originalName: 'contract-a-day-rate-approval.pdf',
			provenance: 'upload',
			contractId: null,
			confidential: true,
			ownerType: null,
			ownerId: null
		})
		.returning();
	return documentRow;
}

const content = [
	'CONTRATTO DI CONSULENZA PROFESSIONALE',
	'tra Vetraria del Garda S.p.A. (P.IVA 02871450230) e dott. Elia Fontana'
].join('\n');

const excerpt = 'tra Vetraria del Garda S.p.A. (P.IVA 02871450230) e dott. Elia Fontana';

function validContractFields(): Record<string, unknown> {
	return {
		client: {
			legalName: 'Vetraria del Garda S.p.A.',
			taxId: '02871450230',
			vatId: null,
			country: 'IT',
			addressLine1: 'Via Industriale 8',
			addressLine2: null,
			addressCity: 'Desenzano del Garda',
			addressPostalCode: '25015',
			addressRegion: null
		},
		contract: {
			title: 'Contratto di Consulenza Professionale',
			signedDocumentReference: 'Rep. n. 14/2025',
			startsOn: '2025-09-01',
			endsOn: '2026-08-31',
			renewalType: 'none',
			renewalNoticeDays: null,
			terminationNoticeDays: 45,
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
				validFrom: '2025-09-01',
				validTo: null,
				kind: 'daily',
				amount: 650,
				unit: 'day',
				allowedFractions: [1, 0.5],
				minimumHours: null,
				disbursementPeriod: null
			}
		],
		clauseFlags: []
	};
}

/** Queues a `'contract'` job and immediately completes it with a scripted
 * answer, the same two-step `enqueueJob` + `markJobDone` `loop.test.ts`'s
 * own `completeOneJob` uses — there is no real runner in this test, only
 * the file it would have left behind. Returns the job id so the caller
 * can attach an `extraction_run` to it, or not, depending which path the
 * test means to exercise. */
async function completeContractJob(
	dir: string,
	documentId: string,
	over: Partial<ProposalCandidate> = {}
): Promise<string> {
	const jobId = await enqueueJob(dir, {
		documentId,
		contractId: null,
		targetType: 'contract',
		content,
		instructions: 'x'
	});
	const job = await readPendingJob(dir, `${jobId}.json`);
	const candidate: ProposalCandidate = {
		documentId,
		contractId: null,
		targetType: 'contract',
		proposedFields: validContractFields(),
		excerpt,
		confidence: 0.9,
		...over
	};
	await markJobDone(dir, `${jobId}.json`, job, candidate);
	return jobId;
}

test('a drained job with a run row reaches applied, carrying the proposal it produced', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'mastro-drain-run-'));

	const outcome = await inRolledBackTransaction(async (tx) => {
		const documentRow = await seedUnclaimedDocument(tx);
		const jobId = await completeContractJob(dir, documentRow.id);
		await createExtractionRun(
			{ jobId, documentId: documentRow.id, targetType: 'contract', enqueuedAt: new Date() },
			tx
		);

		const drained = await drainCompletedJobs(dir, tx);
		const run = await getExtractionRunByJobId(jobId, tx);
		const proposals = await listProposalsForDocument(documentRow.id, tx);

		return { drained, run, proposals };
	});

	expect(outcome.drained).toMatchObject({ applied: 1, skipped: 0, failed: [] });
	expect(outcome.proposals).toHaveLength(1);
	expect(outcome.run?.status).toBe('applied');
	expect(outcome.run?.proposalId).toBe(outcome.proposals[0].id);
	expect(outcome.run?.error).toBeNull();
	expect(outcome.run?.finishedAt).not.toBeNull();
	expect(await listCompletedJobs(dir)).toEqual([]);
});

test('a producer that throws leaves the run failed with the message, and leaves the job in done/ for a retry', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'mastro-drain-run-'));

	const outcome = await inRolledBackTransaction(async (tx) => {
		const documentRow = await seedUnclaimedDocument(tx);
		// The excerpt is not in the document — `writeContractProposal`'s own
		// verbatim check (`contract-producer.ts`) throws before it ever
		// calls `createProposal`, the same failure
		// `contract-producer.test.ts` scripts directly against that
		// function; here it happens inside `drainCompletedJobs`'s own
		// transaction instead.
		const jobId = await completeContractJob(dir, documentRow.id, {
			excerpt: 'this sentence is nowhere in the document'
		});
		await createExtractionRun(
			{ jobId, documentId: documentRow.id, targetType: 'contract', enqueuedAt: new Date() },
			tx
		);

		const drained = await drainCompletedJobs(dir, tx);
		const run = await getExtractionRunByJobId(jobId, tx);
		const proposals = await listProposalsForDocument(documentRow.id, tx);
		const stillInDone = await listCompletedJobs(dir);

		return { jobId, drained, run, proposals, stillInDone };
	});

	expect(outcome.drained.applied).toBe(0);
	expect(outcome.drained.failed).toEqual([
		{ filename: `${outcome.jobId}.json`, reason: expect.stringMatching(/not verbatim/) }
	]);
	expect(outcome.run?.status).toBe('failed');
	expect(outcome.run?.error).toMatch(/not verbatim/);
	expect(outcome.run?.proposalId).toBeNull();
	expect(outcome.proposals).toHaveLength(0);
	// Left in `done/`, not moved to `applied/`: the file a human (or the
	// next sweep) can still retry against, per #278's own acceptance.
	expect(outcome.stillInDone).toEqual([`${outcome.jobId}.json`]);
});

test('a job whose document has no run row still drains exactly as it always has', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'mastro-drain-run-'));

	const outcome = await inRolledBackTransaction(async (tx) => {
		const documentRow = await seedUnclaimedDocument(tx);
		// No `createExtractionRun` call — everything enqueued before #278,
		// which `getExtractionRunByJobId` must answer `null` for.
		await completeContractJob(dir, documentRow.id);

		const drained = await drainCompletedJobs(dir, tx);
		const proposals = await listProposalsForDocument(documentRow.id, tx);

		return { drained, proposals };
	});

	expect(outcome.drained).toMatchObject({ applied: 1, skipped: 0, failed: [] });
	expect(outcome.proposals).toHaveLength(1);
	expect(await listCompletedJobs(dir)).toEqual([]);
});
