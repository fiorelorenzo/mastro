import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import type { DbExecutor } from '$lib/server/db';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import {
	client,
	contract,
	document,
	inboundThread,
	rateCard,
	type ExpensePolicy
} from '$lib/server/db/schema';
import { listProposalsForDocument } from '$lib/server/repositories/proposal';
import { enqueueJob, listPendingJobs, markJobDone, readPendingJob } from '$lib/server/runner/queue';
import type { ProposalCandidate } from '$lib/server/runner/types';
import { drainCompletedJobs } from './drain';

/**
 * #85, the loop with the model's part scripted: a job goes in, the
 * runner's side leaves an answer in `done/`, and draining it writes the
 * proposals a human reviews. What a real model answers is the corpus's
 * question (`scripts/score-day-corpus.ts`), not this one's.
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
	const [documentRow] = await tx
		.insert(document)
		.values({
			hash: 'b'.repeat(64),
			mime: 'message/rfc822',
			size: 64,
			originalName: 'thread.eml',
			provenance: 'mail',
			contractId: contractRow.id,
			confidential: true,
			ownerType: 'contract',
			ownerId: contractRow.id
		})
		.returning();
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
			{ date: '2026-02-03', quantity: 1, scope: 'Analisi', excerpt: 'Confermo il 3' },
			{ date: '2026-02-04', quantity: 0.5, scope: 'Analisi', excerpt: 'la seconda mezza' }
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
