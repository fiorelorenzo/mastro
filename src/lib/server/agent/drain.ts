// #85: the app side of the loop. The runner finishes a job and leaves the
// model's answer in `done/`; this reads it, writes the proposals, and
// moves the file to `applied/`.
//
// A file rather than the runner's stdout. The runner has no write grant
// for `proposal` and the app has no business calling a model, so
// something has to cross between them, and a directory both can see is
// the only seam that survives either process being restarted at the wrong
// moment.
//
// Idempotency is the part worth reading. A crash between writing the
// proposals and moving the file would otherwise write them twice on the
// next drain, so this checks for proposals already carrying that
// document. That check is the real guard; the move is just tidying.

import type { DbExecutor } from '$lib/server/db';
import { listProposalsForDocument } from '$lib/server/repositories/proposal';
import { getContract } from '$lib/server/repositories/contract';
import { getInboundThreadForDocument } from '$lib/server/repositories/inbound-thread';
import {
	listCompletedJobs,
	markJobApplied,
	readCompletedJob,
	type CompletedJob
} from '$lib/server/runner/queue';
import { writeDayProposals, type DayProposalOutcome } from './day-producer';

export interface DrainOutcome {
	readonly applied: number;
	readonly skipped: number;
	/** Jobs whose answer could not be turned into proposals, with the
	 * reason. Left in `done/` rather than moved: a shape the app cannot
	 * read is a bug to look at, not a file to file away. */
	readonly failed: readonly { filename: string; reason: string }[];
	/** Days the model returned that were not written, with the reason. A
	 * count of applied jobs hides the interesting half: a job can succeed
	 * and still have had two thirds of its days refused. */
	readonly rejectedDays: readonly { documentId: string; reason: string }[];
}

/**
 * Turns every completed job into proposals. Returns counts rather than
 * throwing on one bad job, the same "one bad row does not stop the batch"
 * shape the alert engine and the runner's own loop already use.
 */
export async function drainCompletedJobs(
	queueDir: string,
	executor?: DbExecutor
): Promise<DrainOutcome> {
	let applied = 0;
	let skipped = 0;
	const failed: { filename: string; reason: string }[] = [];
	const rejectedDays: { documentId: string; reason: string }[] = [];

	for (const filename of await listCompletedJobs(queueDir)) {
		const job = await readCompletedJob(queueDir, filename);
		try {
			const existing = executor
				? await listProposalsForDocument(job.result.documentId, executor)
				: await listProposalsForDocument(job.result.documentId);
			if (existing.length > 0) {
				// Already drained, or a human already has these in the queue.
				// Either way, writing them again would double the review work
				// for no new information.
				await markJobApplied(queueDir, filename);
				skipped += 1;
				continue;
			}
			const outcome = await applyCompletedJob(job, executor);
			for (const { reason } of outcome.rejected) {
				rejectedDays.push({ documentId: job.result.documentId, reason });
			}
			await markJobApplied(queueDir, filename);
			applied += 1;
		} catch (error) {
			failed.push({ filename, reason: error instanceof Error ? error.message : String(error) });
		}
	}
	return { applied, skipped, failed, rejectedDays };
}

async function applyCompletedJob(
	job: CompletedJob,
	executor?: DbExecutor
): Promise<DayProposalOutcome> {
	if (job.result.targetType !== 'work_unit') {
		throw new Error(`no producer for target type ${job.result.targetType}`);
	}
	const contract = await getContract(job.result.contractId, executor);
	if (!contract) throw new Error(`contract ${job.result.contractId} no longer exists`);

	const thread = executor
		? await getInboundThreadForDocument(job.result.documentId, executor)
		: await getInboundThreadForDocument(job.result.documentId);
	if (!thread) {
		throw new Error(`document ${job.result.documentId} has no inbound thread to date it by`);
	}

	return writeDayProposals(
		{
			documentId: job.result.documentId,
			contractId: job.result.contractId,
			startsOn: contract.startsOn,
			endsOn: contract.endsOn,
			// The message as it was sent to the model, straight off the job:
			// every excerpt is checked against it.
			content: job.request.content
		},
		job.result,
		executor
	);
}
