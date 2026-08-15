/**
 * `Badge`/label bindings for one extraction run's own vocabulary (#278,
 * `docs/specs/2026-08-15-extraction-runs-design.md`) — the `extraction_run`
 * row's `status`, the `extraction_run_event` row's `kind`, and the
 * `proposal.targetType` a run produces. Route-local, the same reasoning
 * `routes/proposals/proposal-status.ts` and `routes/invoices/status.ts`
 * already give for their own status vocabularies: each is read by exactly
 * one route's pages, not by a calendar or an alert the way `workUnitState`
 * is, so it does not belong in `$lib/design`.
 *
 * The status/kind unions are duplicated from
 * `$lib/server/db/schema/extraction-run.ts` rather than imported — that
 * module lives under `$lib/server` and both run pages ship to the client
 * (the live view needs the browser's own `EventSource`), so importing it
 * would bundle server code into client JavaScript. Same duplication
 * `day-state-badge.ts` already documents for the same reason.
 */

import type { BadgeVariant } from '$lib/design';
import * as m from '$lib/paraglide/messages';

export const extractionRunStatuses = [
	'queued',
	'running',
	'extracted',
	'applied',
	'failed'
] as const;
export type ExtractionRunStatusValue = (typeof extractionRunStatuses)[number];

export const runEventKinds = ['message', 'thought', 'tool_call', 'plan', 'stop', 'error'] as const;
export type RunEventKindValue = (typeof runEventKinds)[number];

export const extractionRunTargetTypes = ['contract', 'invoice', 'work_unit'] as const;
export type ExtractionRunTargetTypeValue = (typeof extractionRunTargetTypes)[number];

/** A run reaches exactly one of these and never leaves it — the registry's
 *  own "is this row still moving" check, and what closes the SSE
 *  connection on the run page (design doc: "Close the source on a
 *  terminal status"). */
export function isTerminalRunStatus(status: ExtractionRunStatusValue): boolean {
	return status === 'applied' || status === 'failed';
}

/**
 * `queued`/`running`/`extracted` share the "still moving" reading
 * `workUnitStateBadge` gives `proposed`/`approved`/`invoiced` (neutral or
 * info), but `extracted` is deliberately `warning`, not `info`: it is the
 * exact gap the design doc's incident lived in — the model has already
 * answered and only the write to `applied` is still pending — so a run
 * stuck here needs to read as "watch this" rather than "business as
 * usual" the moment it lingers, in the registry as much as on its own
 * page. `failed` is the only `critical`, matching every other status
 * vocabulary here: critical stays exclusive to a genuine, unresolved
 * failure.
 */
const RUN_STATUS_BADGE: Readonly<Record<ExtractionRunStatusValue, BadgeVariant>> = {
	queued: 'neutral',
	running: 'info',
	extracted: 'warning',
	applied: 'good',
	failed: 'critical'
};

const RUN_STATUS_LABEL: Readonly<Record<ExtractionRunStatusValue, () => string>> = {
	queued: m.extraction_run_status_queued,
	running: m.extraction_run_status_running,
	extracted: m.extraction_run_status_extracted,
	applied: m.extraction_run_status_applied,
	failed: m.extraction_run_status_failed
};

/** The `{ variant, label }` a `Badge` needs to render a run's `status`. */
export function runStatusBadge(status: ExtractionRunStatusValue): {
	variant: BadgeVariant;
	label: string;
} {
	return { variant: RUN_STATUS_BADGE[status], label: RUN_STATUS_LABEL[status]() };
}

/**
 * The transcript's own event kinds are a taxonomy, not a severity scale —
 * `thought`, `tool_call` and `plan` are not "worse" than `message`, they
 * are just different updates the same well-behaved run produces, so
 * `neutral` covers all four. `stop` gets `good`: it is the one kind that
 * appears at most once per run and marks the agent's own turn ending
 * cleanly. `error` is the only kind that is ever actually a problem, so it
 * is the only one that gets `critical` — the same "critical stays
 * exclusive to a real failure" rule `RUN_STATUS_BADGE` follows.
 */
const RUN_EVENT_KIND_BADGE: Readonly<Record<RunEventKindValue, BadgeVariant>> = {
	message: 'neutral',
	thought: 'neutral',
	tool_call: 'neutral',
	plan: 'neutral',
	stop: 'good',
	error: 'critical'
};

const RUN_EVENT_KIND_LABEL: Readonly<Record<RunEventKindValue, () => string>> = {
	message: m.extraction_run_event_kind_message,
	thought: m.extraction_run_event_kind_thought,
	tool_call: m.extraction_run_event_kind_tool_call,
	plan: m.extraction_run_event_kind_plan,
	stop: m.extraction_run_event_kind_stop,
	error: m.extraction_run_event_kind_error
};

/** The `{ variant, label }` a `Badge` needs to render one transcript
 *  event's `kind`. */
export function runEventKindBadge(kind: RunEventKindValue): {
	variant: BadgeVariant;
	label: string;
} {
	return { variant: RUN_EVENT_KIND_BADGE[kind], label: RUN_EVENT_KIND_LABEL[kind]() };
}

const TARGET_TYPE_LABEL: Readonly<Record<ExtractionRunTargetTypeValue, () => string>> = {
	contract: m.extraction_run_target_type_contract,
	invoice: m.extraction_run_target_type_invoice,
	work_unit: m.extraction_run_target_type_work_unit
};

/** A run's `targetType` as prose — the registry's own column and the run
 *  page's own fact line. Falls back to the raw value for a target type
 *  this catalogue does not yet know, the same defensiveness
 *  `proposal.targetType` is stored as plain `text` for in the first
 *  place: a future producer can widen the column before the UI catches
 *  up. */
export function targetTypeLabel(targetType: string): string {
	return targetType in TARGET_TYPE_LABEL
		? TARGET_TYPE_LABEL[targetType as ExtractionRunTargetTypeValue]()
		: targetType;
}

/**
 * A run's own elapsed-or-total span in seconds: `enqueuedAt` to
 * `finishedAt` once the run is terminal, `enqueuedAt` to `now` while it is
 * still moving — the one figure the registry's "duration" column and the
 * run page's own elapsed/total line both read (design doc's own "state,
 * elapsed time, and when it lands, the outcome"). `now` is a parameter
 * rather than `new Date()` inline so a caller re-deriving this after an
 * SSE status event can pass that event's own `at` instant instead of the
 * browser's clock at some later paint.
 */
export function runDurationSeconds(
	run: { enqueuedAt: Date | string; finishedAt: Date | string | null },
	now: Date = new Date()
): number {
	const start = new Date(run.enqueuedAt).getTime();
	const end = run.finishedAt ? new Date(run.finishedAt).getTime() : now.getTime();
	return Math.max(0, (end - start) / 1000);
}

/** One rendered block of a run's transcript. */
export interface TranscriptBlock {
	readonly seq: number;
	readonly at: string;
	readonly kind: RunEventKindValue;
	readonly payload: string;
	readonly parts: number;
}

/**
 * Consecutive updates of one kind, joined into the block a reader
 * actually has in mind.
 *
 * An agent streams its answer in whatever chunks the model emits, and
 * those boundaries carry no meaning: the first real contract extraction
 * arrived as 44 events reading '```', 'json', '{"', 'propos', 'ed',
 * 'Fields', each rendered as its own card with its own badge and
 * timestamp, which is unreadable. Every update is still stored as its own
 * row — a transcript is a record, and a record does not get to
 * editorialise — so this joins at render time only.
 *
 * A different kind between two messages still breaks the block, because a
 * tool call that happened between two sentences happened between them,
 * and collapsing that would misreport the order. The block keeps the
 * first chunk's `seq` and timestamp: it began when it began.
 */
export function coalesceEvents(
	events: readonly { seq: number; at: string; kind: RunEventKindValue; payload: string }[]
): TranscriptBlock[] {
	const blocks: TranscriptBlock[] = [];
	for (const event of events) {
		const open = blocks[blocks.length - 1];
		if (open && open.kind === event.kind) {
			blocks[blocks.length - 1] = {
				...open,
				payload: open.payload + event.payload,
				parts: open.parts + 1
			};
			continue;
		}
		blocks.push({
			seq: event.seq,
			at: event.at,
			kind: event.kind,
			payload: event.payload,
			parts: 1
		});
	}
	return blocks;
}
