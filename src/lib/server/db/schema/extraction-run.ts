import { relations } from 'drizzle-orm';
import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { ExtractionFailureKind } from '$lib/extraction/failure-kind';
// The one canonical list, shared with the registry and the run page so an
// exhaustive `Record` over it cannot go blind to a new status (#398).
export type { ExtractionRunStatus } from '$lib/extraction/run-status';
import type { ExtractionRunStatus } from '$lib/extraction/run-status';
import { id, timestamps } from '../columns';
import { document } from './document';
import { proposal, type ProposalTargetType } from './proposal';

/**
 * `queued` → `running` → `extracted` → `applied` | `failed` (design:
 * `docs/specs/2026-08-15-extraction-runs-design.md`). `extracted` and
 * `applied` are deliberately separate states — the v0.6.5 defect this
 * table exists to make visible lived exactly in the gap between them, the
 * model having answered while the write silently failed, and no state
 * named that gap. Plain text with a CHECK enumerating the known values
 * (the accompanying custom migration), the same reasoning as
 * `document.ownerType`: widening the list is a metadata-only migration,
 * never an `ALTER TYPE ... ADD VALUE`.
 */

/**
 * One row per queued extraction job (epic "extraction runs"), keyed by
 * the job id `enqueueJob` already returns — the object the three views
 * (live status, agent transcript, registry) all read, so the three never
 * drift into three versions of the truth. Written only by the web app:
 * invariant 3 keeps the ACP runner off the database entirely, so the
 * runner's own progress reaches this table only through
 * `extraction_run_event` rows a drain persists from `runs/<jobId>.jsonl`
 * (`src/lib/server/runner/queue.ts`), never a direct write from the
 * runner process.
 *
 * `error` is populated exactly when `status = 'failed'`, and `proposalId`
 * exactly when `status = 'applied'` — both enforced by CHECK constraints
 * in the accompanying custom migration, not application code, the same
 * "state machine constraints are enforced by the database" rule every
 * other table here follows.
 */
export const extractionRun = pgTable('extraction_run', {
	id: id(),
	jobId: uuid('job_id').notNull().unique(),
	documentId: uuid('document_id')
		.notNull()
		.references(() => document.id, { onDelete: 'restrict' }),
	targetType: text('target_type').notNull().$type<ProposalTargetType>(),
	status: text('status').notNull().$type<ExtractionRunStatus>(),
	enqueuedAt: timestamp('enqueued_at', { withTimezone: true }).notNull(),
	// First update observed from the agent, not job creation — the gap
	// between `enqueuedAt` and this is queue wait, not extraction time.
	startedAt: timestamp('started_at', { withTimezone: true }),
	finishedAt: timestamp('finished_at', { withTimezone: true }),
	// `error` is diagnostic text and stays verbatim: a model's malformed
	// JSON, a zod issue list, a quotation missing from the document. It is
	// what makes a failure debuggable, and it is English whatever language
	// the interface speaks. `failureKind` is the part a reader is shown in
	// their own words, recorded where the failure happens and never
	// inferred from `error` afterwards — matching on a diagnostic to work
	// out what it meant is the mistake `$lib/proposals/validation-issue.ts`
	// exists to undo. Null on a run that failed before this column
	// existed; the accompanying custom migration only forbids a kind on a
	// run that did not fail.
	error: text('error'),
	failureKind: text('failure_kind').$type<ExtractionFailureKind>(),
	proposalId: uuid('proposal_id').references(() => proposal.id, { onDelete: 'restrict' }),
	...timestamps()
});

export const extractionRunRelations = relations(extractionRun, ({ one, many }) => ({
	document: one(document, { fields: [extractionRun.documentId], references: [document.id] }),
	proposal: one(proposal, { fields: [extractionRun.proposalId], references: [proposal.id] }),
	events: many(extractionRunEvent)
}));

/**
 * One row per update `nextUpdate()` yielded during the run (design doc,
 * "The one change to the protocol layer"): a message chunk, a thought, a
 * tool call, a plan, or the terminal `stop`/`error`. Append-only, kept
 * indefinitely — the explicit decision recorded in the design doc, over
 * keeping only outcomes or transcripts for failures only. `seq` orders
 * the transcript and, paired with `run_id` under the accompanying custom
 * migration's UNIQUE constraint, makes `appendRunEvents`
 * (`repositories/extraction-run.ts`) idempotent: a reconnecting SSE
 * reader replays lines it has already persisted, and re-inserting the
 * same `(run_id, seq)` is a no-op rather than a duplicate row.
 */
export type RunEventKind = 'message' | 'thought' | 'tool_call' | 'plan' | 'stop' | 'error';

export const extractionRunEvent = pgTable('extraction_run_event', {
	id: id(),
	runId: uuid('run_id')
		.notNull()
		.references(() => extractionRun.id, { onDelete: 'cascade' }),
	seq: integer('seq').notNull(),
	// When the runner observed the update, not when the drain persisted
	// it — the transcript's own clock, independent of drain latency.
	at: timestamp('at', { withTimezone: true }).notNull(),
	kind: text('kind').notNull().$type<RunEventKind>(),
	payload: text('payload').notNull(),
	...timestamps()
});

export const extractionRunEventRelations = relations(extractionRunEvent, ({ one }) => ({
	run: one(extractionRun, { fields: [extractionRunEvent.runId], references: [extractionRun.id] })
}));
