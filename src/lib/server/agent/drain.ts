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

import { db, type DbExecutor } from '$lib/server/db';
import { listProposalsForDocument, type ProposalRow } from '$lib/server/repositories/proposal';
import { getContract } from '$lib/server/repositories/contract';
import { getInboundThreadForDocument } from '$lib/server/repositories/inbound-thread';
import {
	claimRunForApply,
	failRun,
	finishRunApplied,
	getExtractionRunByJobId,
	markRunExtracted
} from '$lib/server/repositories/extraction-run';
import { persistRunProgress } from './run-progress';
import {
	deleteRunProgress,
	listCompletedJobs,
	markJobApplied,
	readCompletedJob,
	type CompletedJob
} from '$lib/server/runner/queue';
import { writeContractProposal } from './contract-producer';
import { writeDayProposals, type DayProposalOutcome } from './day-producer';
import { writeInvoiceProposal, type InvoiceProposalOutcome } from './invoice-producer';

/** What every target type's own write-half returns, narrowed to the one
 * shape `drainCompletedJobs` actually reads off it. `DayProposalOutcome`
 * and `InvoiceProposalOutcome` both satisfy this structurally — a day's
 * own `RejectedDay` carries more (`day`, not just `reason`), which is
 * fine, since nothing here reads more than `reason`. */
interface AppliedJobOutcome {
	readonly proposals: readonly ProposalRow[];
	readonly rejected: readonly { readonly reason: string }[];
}

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
 *
 * A job whose document has an `extraction_run` row (#278: today, every
 * `'contract'` job — a first-intake PDF upload creates one) takes a
 * different path than a job with none (`'work_unit'`/`'invoice'` jobs
 * enqueued before this feature, which have no run to update and drain
 * exactly as they always have, in the `else` branch below): the run's own
 * `extracted` → `applied` | `failed` transitions have to happen alongside
 * the proposal write, guarded against the two drainers that can now reach
 * the same job — this sweep, and the SSE stream watching it live
 * (design doc, "The race this creates, and the guard").
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
		const run = await getExtractionRunByJobId(job.id, executor);

		if (run?.status === 'applied') {
			// Crash recovery: `finishRunApplied` committed on an earlier
			// attempt, but the rename below never ran. Nothing left to do
			// against the database — just finish moving the file so the next
			// sweep stops rediscovering it in `done/`.
			await markJobApplied(queueDir, filename);
			skipped += 1;
			continue;
		}

		if (run?.status === 'failed') {
			// A previous sweep already ran the producer and it threw — the run
			// is `failed` and its reason is already on screen. The file stays
			// in `done/` on purpose (#278's acceptance: "leaves the job in
			// done/ for a retry"), so it is reported here on every sweep, the
			// same as an unassociated job's own failure already is below,
			// rather than going quiet the moment it is first seen.
			failed.push({ filename, reason: run.error ?? 'run already failed' });
			continue;
		}

		if (run) {
			try {
				// Its own statement, committed before the claim below even
				// starts: this fact — the runner's answer landed — must
				// survive a producer that throws after it, the same way
				// `claimRunForApply`'s own doc comment describes a rolled-back
				// claim leaving the run `extracted`, never further back at
				// `running`.
				await markRunExtracted(job.id, executor);

				const runner = executor ?? db;
				const outcome = await runner.transaction(async (tx) => {
					const claimedId = await claimRunForApply(job.id, tx);
					if (claimedId === null) return null;

					const result = await applyCompletedJob(job, tx);
					const [proposal] = result.proposals;
					if (!proposal) {
						throw new Error(
							`extraction for document ${job.result.documentId} produced no proposal ` +
								`for run ${run.id}`
						);
					}
					await finishRunApplied(job.id, proposal.id, tx);
					return result;
				});

				if (outcome === null) {
					// Another drainer already claimed this run — it is applying,
					// or has already applied, it under its own transaction.
					// Whichever one actually wrote the proposals is also the one
					// that renames the file out of `done/`; this sweep has
					// nothing left to do with it.
					skipped += 1;
					continue;
				}

				for (const { reason } of outcome.rejected) {
					rejectedDays.push({ documentId: job.result.documentId, reason });
				}
				await markJobApplied(queueDir, filename);
				// A run nobody streamed live (the scheduler's own safety net)
				// never had a poller persisting its transcript as it went —
				// catch it up before the jsonl file it lived in is deleted for
				// good.
				await persistRunProgress(queueDir, run, executor);
				await deleteRunProgress(queueDir, job.id);
				applied += 1;
			} catch (error) {
				const reason = error instanceof Error ? error.message : String(error);
				await failRun(job.id, reason, executor);
				failed.push({ filename, reason });
			}
			continue;
		}

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

/**
 * Writes the row `job.result.targetType`'s own producer produces —
 * mirrors `repositories/proposal.ts`'s `applyProposal` dispatch, one
 * level up: that switch decides what an *accepted* proposal writes to
 * the ledger, this one decides which producer turns a *finished
 * extraction job* into a proposal in the first place. `job.result.
 * targetType` is a plain `string` (`runner/types.ts`'s own choice — the
 * runner never interprets it), so this is a `switch`/`default` rather
 * than the compile-time-exhaustive kind `applyProposal` can afford.
 */
async function applyCompletedJob(
	job: CompletedJob,
	executor?: DbExecutor
): Promise<AppliedJobOutcome> {
	switch (job.result.targetType) {
		case 'work_unit':
			return applyDayJob(job, executor);
		case 'invoice':
			return applyInvoiceJob(job, executor);
		case 'contract':
			return applyContractJob(job, executor);
		default:
			throw new Error(`no producer for target type ${job.result.targetType}`);
	}
}

/** `job.result.contractId` is `string | null` at the type level
 * (`runner/types.ts`'s `ProposalCandidate` — one shape shared by every
 * target type, since #86 needed it nullable for a first-intake
 * `'contract'` job). For `work_unit` and `invoice`, it is never actually
 * null: `job.ts`'s own defence-in-depth check refuses a job whose
 * `contractId` disagrees with the document it names, and #86's own CHECK
 * constraint (`proposal_contract_id_required_unless_first_intake_
 * contract`) means a document behind a `work_unit`/`invoice` job always
 * has one. This is that runtime guarantee, made into the type-level
 * narrowing `applyDayJob`/`applyInvoiceJob` need. */
function requireJobContractId(job: CompletedJob): string {
	if (job.result.contractId === null) {
		throw new Error(
			`job for document ${job.result.documentId} has no contractId, which target type ` +
				`${job.result.targetType} requires`
		);
	}
	return job.result.contractId;
}

async function applyDayJob(job: CompletedJob, executor?: DbExecutor): Promise<DayProposalOutcome> {
	const contractId = requireJobContractId(job);
	const contract = await getContract(contractId, executor);
	if (!contract) throw new Error(`contract ${contractId} no longer exists`);

	const thread = executor
		? await getInboundThreadForDocument(job.result.documentId, executor)
		: await getInboundThreadForDocument(job.result.documentId);
	if (!thread) {
		throw new Error(`document ${job.result.documentId} has no inbound thread to date it by`);
	}

	return writeDayProposals(
		{
			documentId: job.result.documentId,
			contractId,
			startsOn: contract.startsOn,
			endsOn: contract.endsOn,
			// The message as it was sent to the model, straight off the job:
			// every excerpt is checked against it.
			content: job.request.content,
			// What "has no inbound thread to date it by" above is actually
			// for (#244): the year-rollover guard needs the message's own
			// date, and the queue file never carried one — only the thread
			// row did.
			messageDate: thread.receivedAt.toISOString().slice(0, 10)
		},
		job.result,
		executor
	);
}

/**
 * #87's own half: no contract lookup, no inbound thread — an invoice PDF
 * carries its own absolute dates, so there is nothing here to date
 * relative to a message the way a day proposal needs. `job.request.
 * content` is exactly the PDF text the model saw (`enqueue`'s caller
 * already ran it through `extractPdfText` once, before the job was ever
 * queued), so `writeInvoiceProposal` reads it back rather than this file
 * touching the blob store or a PDF library at all.
 */
async function applyInvoiceJob(
	job: CompletedJob,
	executor?: DbExecutor
): Promise<InvoiceProposalOutcome> {
	return writeInvoiceProposal(
		{ documentId: job.result.documentId, contractId: requireJobContractId(job) },
		job.request.content,
		job.result,
		executor
	);
}

/**
 * #86's own half: no contract lookup at all — a first-intake `'contract'`
 * job's document has no contract to look up, which is the entire point
 * (`db/schema/document.ts`'s "unclaimed" state). `job.request.content` is
 * exactly the PDF text the model saw, the same way `applyInvoiceJob`
 * reads it back rather than touching the blob store or a PDF library
 * here.
 */
async function applyContractJob(
	job: CompletedJob,
	executor?: DbExecutor
): Promise<AppliedJobOutcome> {
	// `ContractProposalOutcome` carries a single `proposal` (a contract PDF
	// is never fan-out the way a day-approval message is) and
	// `rejectedFlags` rather than `rejected` — the shape that reads best
	// for `writeContractProposal`'s own direct callers. This adapts it to
	// the plural, `rejected`-named shape `drainCompletedJobs` reads off
	// every producer.
	const outcome = await writeContractProposal(
		{ documentId: job.result.documentId, content: job.request.content },
		job.result,
		executor
	);
	return { proposals: [outcome.proposal], rejected: outcome.rejectedFlags };
}
