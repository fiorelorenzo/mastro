// Extraction runs (docs/specs/2026-08-15-extraction-runs-design.md): the
// object the three views — live status, agent transcript, registry — all
// read, so they cannot drift into three versions of the truth. The web
// app is the only writer here, by invariant 3: the ACP runner keeps no
// database access at all, and reaches this table only indirectly, through
// `runs/<jobId>.jsonl` (`src/lib/server/runner/queue.ts`) that whoever
// drains a job — the watching SSE request, or the five-minute scheduler
// tick that is every run's safety net — reads and persists as
// `extraction_run_event` rows via `appendRunEvents` below.
//
// `status` moves `queued` → `running` → `extracted` → `applied` | `failed`
// (`db/schema/extraction-run.ts`'s own doc comment has the full reasoning
// for why `extracted` and `applied` are separate states). Every transition
// past `queued` is its own function here rather than a generic "set
// status", because each one carries its own side effect — `started_at`,
// `finished_at`, `error`, `proposal_id` — that a generic setter would
// leave callers to remember individually.

import { and, asc, desc, eq, inArray, notInArray } from 'drizzle-orm';
import type { ExtractionFailureKind } from '$lib/extraction/failure-kind';
import { db, type DbExecutor } from '$lib/server/db';
import {
	document,
	extractionRun,
	extractionRunEvent,
	type ProposalTargetType,
	type RunEventKind
} from '$lib/server/db/schema';

export type ExtractionRunRow = typeof extractionRun.$inferSelect;
export type RunEventRow = typeof extractionRunEvent.$inferSelect;

export type ExtractionRunInput = {
	jobId: string;
	documentId: string;
	targetType: ProposalTargetType;
	enqueuedAt: Date;
};

/** {@link listExtractionRuns}'s own row shape — the run plus its
 * document's display name, named here rather than left for the registry
 * page to derive with `ReturnType`, the same reasoning `InvoiceListRow`
 * (`repositories/invoice.ts`) gives for doing the same. */
export type ExtractionRunListRow = ExtractionRunRow & { documentOriginalName: string | null };

/** One line the runner observed, off `runs/<jobId>.jsonl`
 * (`RunProgressLine`, `runner/types.ts`) — `kind` is a plain `string`,
 * not the narrower union that type declares, because this repository
 * takes whatever a drain read off disk and persists it; validating the
 * shape is the drain's job, not this insert's. */
export type RunEventInput = {
	seq: number;
	at: Date;
	kind: string;
	payload: string;
};

/**
 * Creates the run row a contract upload's redirect target needs to exist
 * before it can link to it (design doc, "Making it immediate"): keyed by
 * the job id `enqueueJob` already returns, `queued` from the moment the
 * job is written to `pending/`, before any runner process has even
 * started on it.
 */
export async function createExtractionRun(
	input: ExtractionRunInput,
	executor: DbExecutor = db
): Promise<ExtractionRunRow> {
	const [row] = await executor
		.insert(extractionRun)
		.values({
			jobId: input.jobId,
			documentId: input.documentId,
			targetType: input.targetType,
			status: 'queued',
			enqueuedAt: input.enqueuedAt
		})
		.returning();
	return row;
}

export async function getExtractionRun(
	id: string,
	executor: DbExecutor = db
): Promise<ExtractionRunRow | null> {
	const [row] = await executor.select().from(extractionRun).where(eq(extractionRun.id, id));
	return row ?? null;
}

/** The run page's own lookup, keyed by the id the queue file and the
 * runner both know instead of this table's own `id` — neither ever sees
 * the other (invariant 3). */
export async function getExtractionRunByJobId(
	jobId: string,
	executor: DbExecutor = db
): Promise<ExtractionRunRow | null> {
	const [row] = await executor.select().from(extractionRun).where(eq(extractionRun.jobId, jobId));
	return row ?? null;
}

/** How many attempts `documentId` has already had (#315): one row per
 * `enqueueJob` call this document was ever the subject of, the original
 * plus every retry (`agent/retry.ts` creates a fresh run row per retry
 * rather than reusing the failed one, so this never needs to
 * distinguish the first attempt from a later one). The retry bound
 * counts against this, not a column of its own — no migration needed,
 * and no risk of it drifting from what actually happened. Row count in
 * application code rather than `count(*)` in SQL: a document is bounded
 * to a handful of attempts by the same limit this feeds, so there is
 * never a table scan hiding behind the simpler query. */
export async function countExtractionRunsForDocument(
	documentId: string,
	executor: DbExecutor = db
): Promise<number> {
	const rows = await executor
		.select({ id: extractionRun.id })
		.from(extractionRun)
		.where(eq(extractionRun.documentId, documentId));
	return rows.length;
}

/**
 * When each of `documentIds` was last handed to the runner (#398, #403).
 *
 * The enqueue guard. It first asked "does this document have a proposal",
 * which is a different question and answers the wrong way for a message
 * that legitimately approves nothing: no proposal is ever written, so the
 * document looked un-extracted forever and was re-queued on every tick.
 * Measured on the live instance: `queued 3` on every scheduler run, five
 * minutes apart, indefinitely - three newsletters costing a model call
 * each, 864 a day, to re-learn that they approve no days.
 *
 * It then asked "has any message of this conversation been extracted",
 * which is too coarse in the other direction (#403): a reply arriving in
 * a conversation that was already read found a sibling with a run and was
 * skipped, so a client answering an earlier offer was never read at all.
 * A timestamp answers both, because the real question is whether the
 * conversation has been extracted *since its newest message arrived*.
 *
 * Any run counts, whatever its status. `queued` and `running` mean one is
 * in flight and a second would be duplicate work; `applied` and
 * `nothing_proposed` mean it is done; `failed` is deliberately included
 * too, because re-trying a failed extraction is #315's explicit,
 * human-driven path and not something an automatic sweep should do behind
 * everyone's back every five minutes.
 *
 * One query for the batch rather than `countExtractionRunsForDocument` per
 * thread: the enqueue pass already reads its contracts, documents and
 * proposals in three batched lookups and this is the fourth.
 */
export async function lastExtractionByDocument(
	documentIds: readonly string[],
	executor: DbExecutor = db
): Promise<Map<string, Date>> {
	if (documentIds.length === 0) return new Map();
	const rows = await executor
		.select({ documentId: extractionRun.documentId, enqueuedAt: extractionRun.enqueuedAt })
		.from(extractionRun)
		.where(inArray(extractionRun.documentId, [...documentIds]));
	const latest = new Map<string, Date>();
	for (const row of rows) {
		const current = latest.get(row.documentId);
		if (!current || row.enqueuedAt > current) latest.set(row.documentId, row.enqueuedAt);
	}
	return latest;
}

/** Every run, newest first, with its document's name for display — the
 * registry's own query (design doc, "The registry (C)": "the view that
 * makes a failure repeating every five minutes visible"). A `leftJoin`,
 * not an `innerJoin`: `document_id` is `ON DELETE RESTRICT` so the row it
 * points at is never actually missing, but a row that could not go missing
 * is not the same guarantee as a row this query cannot return null for. */
export async function listExtractionRuns(
	limit: number,
	executor: DbExecutor = db
): Promise<ExtractionRunListRow[]> {
	const rows = await executor
		.select({ run: extractionRun, documentOriginalName: document.originalName })
		.from(extractionRun)
		.leftJoin(document, eq(extractionRun.documentId, document.id))
		.orderBy(desc(extractionRun.enqueuedAt))
		.limit(limit);
	return rows.map((row) => ({
		...row.run,
		documentOriginalName: row.documentOriginalName ?? null
	}));
}

/** Moves a run from `queued` to `running` the moment the stream observes
 * the runner's first update (design doc: "First line observed moves the
 * run to `running`"). Guarded on the run still being `queued`, so a
 * duplicate or late call — the scheduler's own drain catching up on a
 * run someone already watched live — never resets `started_at` to a
 * later time than the first update that actually arrived. */
export async function markRunRunning(
	jobId: string,
	startedAt: Date,
	executor: DbExecutor = db
): Promise<void> {
	await executor
		.update(extractionRun)
		.set({ status: 'running', startedAt })
		.where(and(eq(extractionRun.jobId, jobId), eq(extractionRun.status, 'queued')));
}

/** Moves a run to `extracted` once the runner's answer lands in `done/`.
 * This is precisely the state the v0.6.5 incident made invisible: the
 * model had already answered here, and only the write this run is still
 * waiting for — `finishRunApplied` or `failRun` below — was left, and
 * failing silently before this table existed to name the gap.
 *
 * Guarded away from the two terminal states, the same shape
 * `markRunRunning` above already uses for its own duplicate-call case:
 * `drainCompletedJobs` calls this for every job it finds in `done/`
 * before attempting `claimRunForApply`, since nothing else marks a run
 * `extracted` for the scheduler's own, nobody-was-watching sweep — which
 * means two racing drainers (a watching stream and the five-minute tick)
 * can both reach this call for the same run. Without the guard, a
 * drainer that reads stale state and loses that race could still land
 * here *after* the winner's `finishRunApplied` already committed
 * `applied`, and set `status` back to `extracted` while `proposal_id`
 * stays populated — `extraction_run_proposal_id_iff_applied` would then
 * reject the statement outright, but only after the caller has no clean
 * way to tell "someone else already finished this" from a real failure.
 * The `WHERE` below makes the same case a silent no-op instead: the
 * `UPDATE` simply matches nothing, and the caller's own next read of the
 * row sees the truth.
 */
export async function markRunExtracted(jobId: string, executor: DbExecutor = db): Promise<void> {
	await executor
		.update(extractionRun)
		.set({ status: 'extracted' })
		.where(
			and(eq(extractionRun.jobId, jobId), notInArray(extractionRun.status, ['applied', 'failed']))
		);
}

/**
 * The concurrency guard the design describes ("The race this creates,
 * and the guard"): once a run reaches `extracted`, two drainers can reach
 * for it at once — the request watching its own SSE stream, which drains
 * the instant the runner writes to `done/`, and the five-minute scheduler
 * tick that is every run's safety net for a closed tab or a locked phone.
 * Both can observe `status = 'extracted'` in the same instant, and only
 * one may go on to write the proposal(s) that extraction produced.
 *
 * This is a plain `UPDATE ... WHERE status = 'extracted' RETURNING id`,
 * not a mutex: whichever caller's statement actually executes first takes
 * Postgres's own row lock, and the other blocks until it commits or rolls
 * back. A rollback — the producer throws after this claim succeeds —
 * releases the row exactly as it was, `extracted`, for the blocked
 * caller to claim in turn on retry; a commit leaves it `applied`, so the
 * blocked caller's own `WHERE status = 'extracted'` then matches nothing
 * and it gets `null` back — "another drainer got here first" (design
 * doc), told apart from "this job was never extracted at all" the same
 * way `claimDocumentForContract`'s callers are expected to already know
 * which one they are in.
 *
 * It deliberately does **not** itself set `status` to `'applied'`: doing
 * so here would leave the row `applied` with `proposal_id` still null,
 * because the proposal this run produces does not exist yet at claim
 * time — and `extraction_run_proposal_id_iff_applied` (the accompanying
 * custom migration) is a plain CHECK, which Postgres validates
 * immediately after every statement, never deferred the way a `UNIQUE`
 * or `FK` constraint can be. `status` and `proposal_id` have to change
 * together, in the one statement `finishRunApplied` below issues; this
 * claim only touches the row (bumping `updated_at`, which takes the same
 * row lock) to serialize the two drainers before either starts writing
 * proposals — the point of claiming early rather than only guarding the
 * final write, since the loser then skips that work entirely instead of
 * producing rows nobody will keep.
 */
export async function claimRunForApply(
	jobId: string,
	executor: DbExecutor = db
): Promise<string | null> {
	const [row] = await executor
		.update(extractionRun)
		.set({ updatedAt: new Date() })
		.where(and(eq(extractionRun.jobId, jobId), eq(extractionRun.status, 'extracted')))
		.returning({ id: extractionRun.id });
	return row?.id ?? null;
}

/**
 * The write `claimRunForApply` clears the way for: the run's terminal
 * `applied` state and the proposal it produced, set together in one
 * statement, which is what `extraction_run_proposal_id_iff_applied`
 * requires (see `claimRunForApply`'s own doc comment for why the two
 * cannot be set in separate statements). Still guarded on `status =
 * 'extracted'` itself, not just `job_id` — safe to call on its own, not
 * only chained after `claimRunForApply` in the same transaction, and a
 * no-op `UPDATE` matching nothing if another drainer already finished
 * this run.
 */
export async function finishRunApplied(
	jobId: string,
	proposalId: string,
	executor: DbExecutor = db
): Promise<void> {
	await executor
		.update(extractionRun)
		.set({ status: 'applied', proposalId, finishedAt: new Date() })
		.where(and(eq(extractionRun.jobId, jobId), eq(extractionRun.status, 'extracted')));
}

/**
 * The third terminal state: the extraction was read and had nothing in it
 * to propose (#398).
 *
 * Guarded on `extracted`, exactly as `finishRunApplied` is, so it takes
 * part in the same claim race and cannot move a run that some other sweep
 * already finished. No `proposalId` and no `error`, which is the whole
 * point of the status existing: neither of the CHECKs that tie those
 * columns to `applied` and `failed` should have to bend to accommodate a
 * message that simply approved no days.
 */
export async function finishRunNothingProposed(
	jobId: string,
	executor: DbExecutor = db
): Promise<void> {
	await executor
		.update(extractionRun)
		.set({ status: 'nothing_proposed', finishedAt: new Date() })
		.where(and(eq(extractionRun.jobId, jobId), eq(extractionRun.status, 'extracted')));
}

/** Moves a run to its other terminal state: the runner's own extraction
 * call threw, or a producer's write rejected after `claimRunForApply`
 * won the race for it. Either way `error` is what the run page and the
 * registry show in place of an outcome — verified against the incident
 * this table exists to prevent a repeat of (design doc: "reached
 * `extracted`, then turned `failed` with `client.taxId: Invalid input:
 * expected string, received null` on screen"). */
export async function failRun(
	jobId: string,
	failureKind: ExtractionFailureKind,
	error: string,
	executor: DbExecutor = db
): Promise<void> {
	await executor
		.update(extractionRun)
		.set({ status: 'failed', finishedAt: new Date(), error, failureKind })
		.where(eq(extractionRun.jobId, jobId));
}

/**
 * Persists updates a drain read off `runs/<jobId>.jsonl` — the jsonl is a
 * transport buffer, never the record (design doc): a run's history is
 * read from these rows, never from disk. `ON CONFLICT DO NOTHING` against
 * `extraction_run_event_run_id_seq_unique` (the accompanying custom
 * migration) is what makes this idempotent per `(run_id, seq)`: the SSE
 * stream reconnecting after a dropped connection re-tails the file from
 * its own start and replays lines it has already persisted, and a repeat
 * insert of an already-stored `seq` must be a no-op, never a second
 * transcript row for one update.
 */
export async function appendRunEvents(
	runId: string,
	events: readonly RunEventInput[],
	executor: DbExecutor = db
): Promise<void> {
	if (events.length === 0) return;
	await executor
		.insert(extractionRunEvent)
		.values(
			events.map((event) => ({
				runId,
				seq: event.seq,
				at: event.at,
				kind: event.kind as RunEventKind,
				payload: event.payload
			}))
		)
		.onConflictDoNothing();
}

/** A run's transcript, oldest first — the one rendering path the design
 * doc's "three views" both live status and history read (design doc,
 * "The agent run (B)": "reopening a finished run replays the identical
 * rows"). */
export async function listRunEvents(
	runId: string,
	executor: DbExecutor = db
): Promise<RunEventRow[]> {
	return executor
		.select()
		.from(extractionRunEvent)
		.where(eq(extractionRunEvent.runId, runId))
		.orderBy(asc(extractionRunEvent.seq));
}
