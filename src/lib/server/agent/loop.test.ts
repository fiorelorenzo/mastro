import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import type { DbExecutor } from '$lib/server/db';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import {
	approval,
	client,
	contract,
	dayReadingConflict,
	inboundThread,
	rateCard,
	workUnit,
	type ExpensePolicy
} from '$lib/server/db/schema';
import { storeDocument } from '$lib/server/repositories/document';
import {
	createExtractionRun,
	getExtractionRunByJobId
} from '$lib/server/repositories/extraction-run';
import {
	acceptProposal,
	createProposal,
	listProposalsForDocument,
	rejectProposal
} from '$lib/server/repositories/proposal';
import {
	getWorkUnit,
	listEligibleWorkUnitsForInvoicing,
	listWorkUnitsBetween,
	transitionWorkUnit
} from '$lib/server/repositories/work-unit';
import { enqueueJob, listPendingJobs, markJobDone, readPendingJob } from '$lib/server/runner/queue';
import type { ProposalCandidate } from '$lib/server/runner/types';
import { drainCompletedJobs } from './drain';

/**
 * #85, the loop with the model's part scripted: a job goes in, the
 * runner's side leaves an answer in `done/`, and draining it writes the
 * proposals a human reviews. What a real model answers is the corpus's
 * question (`scripts/score-day-corpus.ts`), not this one's.
 *
 * The document is archived through `storeDocument` (real bytes, with a
 * `From` header) rather than a bare row, because #209's whole-path test
 * below accepts proposals produced from it, and `acceptProposal` reads
 * the archived message back to build the approval it rests on.
 */
async function seed(tx: DbExecutor) {
	const [clientRow] = await tx
		.insert(client)
		.values({
			legalName: 'Loop SRL',
			taxId: `IT${Date.now()}`,
			country: 'IT',
			addressLine1: 'Via Prova 1',
			addressCity: 'Milano',
			addressPostalCode: '20121',
			noticeChannel: 'email'
		})
		.returning();
	const [contractRow] = await tx
		.insert(contract)
		.values({
			clientId: clientRow.id,
			title: 'Contratto quadro 2026',
			startsOn: '2026-01-01',
			endsOn: '2026-12-31',
			renewalType: 'none',
			terminationNoticeDays: 30,
			paymentTerms: { kind: 'net', days: 30 },
			invoicingCadence: 'monthly',
			currency: 'EUR',
			taxTreatment: 'generic',
			expensePolicy: { kind: 'not_reimbursed' } satisfies ExpensePolicy
		})
		.returning();
	await tx.insert(rateCard).values({
		contractId: contractRow.id,
		validFrom: '2026-01-01',
		kind: 'daily',
		amount: 650,
		unit: 'day',
		allowedFractions: [1, 0.5]
	});
	const documentRow = await storeDocument(
		{
			bytes: new TextEncoder().encode(
				[
					'From: ops@acme.example',
					'To: agent@mastro.example',
					'Subject: Giornate',
					'',
					'Confermo il 3 e il 4 febbraio, la seconda mezza.'
				].join('\r\n')
			),
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
	await tx.insert(inboundThread).values({
		contractId: contractRow.id,
		documentId: documentRow.id,
		mailbox: 'INBOX/Acme',
		imapUidValidity: 1,
		imapUid: 1,
		messageId: '<probe@example.com>',
		subject: 'Giornate',
		receivedAt: new Date('2026-02-02T09:00:00Z')
	});
	return { contractId: contractRow.id, documentId: documentRow.id };
}

const answer = (documentId: string, contractId: string): ProposalCandidate => ({
	documentId,
	contractId,
	targetType: 'work_unit',
	proposedFields: {
		days: [
			{
				date: '2026-02-03',
				quantity: 1,
				scope: 'Analisi',
				excerpt: 'Confermo il 3',
				messageIndex: 0
			},
			{
				date: '2026-02-04',
				quantity: 0.5,
				scope: 'Analisi',
				excerpt: 'la seconda mezza',
				messageIndex: 0
			}
		]
	},
	excerpt: 'Confermo il 3 e il 4 febbraio, la seconda mezza.',
	confidence: 0.8
});

async function completeOneJob(dir: string, documentId: string, contractId: string) {
	const id = await enqueueJob(dir, {
		documentId,
		contractId,
		targetType: 'work_unit',
		content: 'Confermo il 3 e il 4 febbraio, la seconda mezza.',
		instructions: 'x'
	});
	const job = await readPendingJob(dir, `${id}.json`);
	await markJobDone(dir, `${id}.json`, job, answer(documentId, contractId));
}

test('a completed job becomes one proposal per day, and a replay does not double them', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'mastro-agent-loop-'));

	const outcome = await inRolledBackTransaction(async (tx) => {
		const { contractId, documentId } = await seed(tx);
		await completeOneJob(dir, documentId, contractId);

		const first = await drainCompletedJobs(dir, tx);
		const proposals = await listProposalsForDocument(documentId, tx);

		// The same document extracted twice — a job re-enqueued by hand, or
		// a poller that handed the message off again. The guard is the
		// proposals that already exist, not the queue file.
		await completeOneJob(dir, documentId, contractId);
		const second = await drainCompletedJobs(dir, tx);
		const afterReplay = await listProposalsForDocument(documentId, tx);

		return { first, second, proposals, afterReplay };
	});

	expect(outcome.first).toMatchObject({ applied: 1, skipped: 0, failed: [] });
	expect(outcome.proposals.map((row) => row.proposedFields)).toEqual([
		{ date: '2026-02-03', quantity: 1, scope: 'Analisi' },
		{ date: '2026-02-04', quantity: 0.5, scope: 'Analisi' }
	]);
	expect(outcome.proposals.map((row) => row.excerpt)).toEqual([
		'Confermo il 3',
		'la seconda mezza'
	]);
	expect(outcome.second).toMatchObject({ applied: 0, skipped: 1 });
	expect(outcome.afterReplay).toHaveLength(2);
	expect(await listPendingJobs(dir)).toEqual([]);
});

/**
 * #209's own acceptance: the whole loop, end to end — a queued extraction,
 * a drained answer, a human accept — ending with a day that (a) is
 * `approved`, (b) is linked to an approval whose excerpt and document are
 * the source message's, (c) appears in the month's feed, and (d) becomes
 * invoiceable once marked `worked`. A third, declined proposal from the
 * same message proves reject still leaves nothing behind.
 */
test('#209: the whole path — queued extraction, drained answer, human accept — ends with an invoiceable day', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'mastro-agent-loop-'));

	const outcome = await inRolledBackTransaction(async (tx) => {
		const { contractId, documentId } = await seed(tx);
		await completeOneJob(dir, documentId, contractId);
		await drainCompletedJobs(dir, tx);

		const proposals = await listProposalsForDocument(documentId, tx);
		expect(proposals).toHaveLength(2);
		const [thursday, friday] = proposals;

		// The human accept — each proposal reviewed and decided on its own,
		// the review screen's actual shape (#83), even though both rest on
		// the same email.
		const acceptedThursday = await acceptProposal(
			thursday.id,
			{ decidedBy: 'lorenzo@example.com' },
			tx
		);
		const acceptedFriday = await acceptProposal(
			friday.id,
			{ decidedBy: 'lorenzo@example.com' },
			tx
		);

		const dayOne = await getWorkUnit(acceptedThursday.resultId as string, tx);
		const dayTwo = await getWorkUnit(acceptedFriday.resultId as string, tx);

		const [approvalRow] = await tx
			.select()
			.from(approval)
			.where(eq(approval.id, dayOne!.approvalId as string));

		// (c) appears in the month's feed — the calendar's own query
		// (`listWorkUnitsBetween`), unfiltered by state.
		const inMonth = await listWorkUnitsBetween('2026-02-01', '2026-02-28', tx);

		// (d) becomes invoiceable once marked worked — a further, separate
		// human action; accepting a proposal never claims to know the day
		// was actually worked.
		const worked = await transitionWorkUnit(
			dayOne!.id,
			{ state: 'worked' },
			{ kind: 'human', email: 'lorenzo@example.com' },
			'actually worked it',
			tx
		);
		const eligible = await listEligibleWorkUnitsForInvoicing(contractId, tx);

		// Reject still leaves nothing behind: a third day the model
		// proposed from the same message, but a human declines.
		const declined = await createProposal(
			{
				documentId,
				contractId,
				targetType: 'work_unit',
				proposedFields: { date: '2026-02-05', quantity: 1, scope: 'Analisi' },
				excerpt: 'not actually confirmed',
				confidence: 0.3
			},
			tx
		);
		await rejectProposal(declined.id, 'lorenzo@example.com', tx);
		const rejectedDayCount = (await listWorkUnitsBetween('2026-02-05', '2026-02-05', tx)).length;
		const approvalsForContract = await tx
			.select()
			.from(approval)
			.where(eq(approval.contractId, contractId));

		return {
			documentId,
			dayOne,
			dayTwo,
			approvalRow,
			inMonth,
			worked,
			eligible,
			rejectedDayCount,
			approvalCount: approvalsForContract.length
		};
	});

	expect(outcome.dayOne?.state).toBe('approved');
	expect(outcome.dayTwo?.state).toBe('approved');
	expect(outcome.dayOne?.approvalId).toBeTruthy();
	// One approval, not one per day: both proposals came from the same
	// source message.
	expect(outcome.dayTwo?.approvalId).toBe(outcome.dayOne?.approvalId);
	expect(outcome.approvalCount).toBe(1);

	expect(outcome.approvalRow.channel).toBe('email');
	expect(outcome.approvalRow.sender).toBe('ops@acme.example');
	expect(outcome.approvalRow.messageId).toBe('<probe@example.com>');
	// The excerpt is the day's own span, not the whole message.
	expect(outcome.approvalRow.excerpt).toBe('Confermo il 3');
	expect(outcome.approvalRow.documentId).toBe(outcome.documentId);

	expect(outcome.inMonth.map((row) => row.id)).toEqual(
		expect.arrayContaining([outcome.dayOne!.id, outcome.dayTwo!.id])
	);

	expect(outcome.worked.state).toBe('worked');
	expect(outcome.eligible.map((row) => row.id)).toContain(outcome.dayOne!.id);

	expect(outcome.rejectedDayCount).toBe(0);
});

test('a conflict row written from a job-driven read carries the run behind it', async () => {
	// The `document` is already `writeDayProposals`'s evidence (invariant
	// 4); the `extraction_run` is the *how* — since #281 made every
	// extraction a run a reviewer can open and watch, a conflict row that
	// carries it lets them jump straight from the disagreement to the
	// transcript that produced it. `applyDayJob` (`drain.ts`) is the one
	// place that can resolve it, off the job id the queue file and this
	// run row both carry — `proposeDaysFromMessage`'s own tests cover the
	// non-job-driven case, which stays `null`.
	const dir = await mkdtemp(join(tmpdir(), 'mastro-agent-loop-conflict-'));

	const outcome = await inRolledBackTransaction(async (tx) => {
		const { contractId, documentId } = await seed(tx);
		// Recorded on the ledger already, a full day.
		await tx.insert(workUnit).values({
			contractId,
			date: '2026-02-03',
			quantity: 1,
			scope: 'Analisi',
			state: 'worked_without_approval'
		});

		const content = 'Confermo il 3, ma solo mezza giornata.';
		const jobId = await enqueueJob(dir, {
			documentId,
			contractId,
			targetType: 'work_unit',
			content,
			instructions: 'x'
		});
		await createExtractionRun(
			{ jobId, documentId, targetType: 'work_unit', enqueuedAt: new Date() },
			tx
		);
		const job = await readPendingJob(dir, `${jobId}.json`);
		// Disagrees with the ledger: the mail now says half a day, the
		// recorded day is a full one.
		const candidate: ProposalCandidate = {
			documentId,
			contractId,
			targetType: 'work_unit',
			proposedFields: {
				days: [
					{
						date: '2026-02-03',
						quantity: 0.5,
						scope: 'Analisi',
						excerpt: content,
						messageIndex: 0
					}
				]
			},
			excerpt: content,
			confidence: 0.8
		};
		await markJobDone(dir, `${jobId}.json`, job, candidate);

		await drainCompletedJobs(dir, tx);

		const run = await getExtractionRunByJobId(jobId, tx);
		const conflicts = await tx
			.select()
			.from(dayReadingConflict)
			.where(eq(dayReadingConflict.contractId, contractId));
		return { run, conflicts };
	});

	expect(outcome.conflicts).toHaveLength(1);
	expect(outcome.conflicts[0].proposedFields).toMatchObject({ quantity: 0.5 });
	expect(outcome.run).not.toBeNull();
	expect(outcome.conflicts[0].extractionRunId).toBe(outcome.run?.id);
});
