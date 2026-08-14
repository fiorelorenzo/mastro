// Pure types and decision logic for the offline day queue (#62). Kept
// apart from offline-queue.svelte.ts (fetch/reactive-state wiring) and
// offline-queue-db.ts (IndexedDB access) the same way freshness-policy.ts
// is kept apart from sw-client.svelte.ts: everything that can be decided
// from plain values is testable without a browser.
//
// The replay contract, in one place: replaying a queued entry posts the
// exact same request use:enhance would have sent for a live submission —
// same URL, same headers, the same form fields, including the
// client-generated `workUnitId` the entry was queued under — against the
// /day/new action, and reads the response the same way $app/forms's own
// enhance() does internally (see offline-queue.svelte.ts). The server
// side of that contract lives in createWorkUnit
// (repositories/work-unit.ts): an insert whose id already exists is a
// no-op that returns the existing row, so replaying the same entry twice
// is guaranteed to produce exactly one day, never a duplicate and never
// an error.

export type QueuedDayStatus = 'pending' | 'syncing' | 'failed';

export interface QueuedDay {
	/** Also the work_unit.id this entry will create once it lands — see
	 * the module doc comment for why that is what makes a replay
	 * idempotent. */
	readonly id: string;
	readonly queuedAt: string;
	/** A snapshot of the /day/new form's fields at the moment it could not
	 * reach the server, replayed verbatim on reconnect. */
	readonly fields: Readonly<Record<string, string>>;
	readonly status: QueuedDayStatus;
	/** Set only once `status` is `'failed'`: the reason the server gave
	 * for refusing the mutation. */
	readonly error?: string;
}

export type ReplayOutcome = 'synced' | 'rejected' | 'offline';

/** The shape both classifyReplay and extractRejectionMessage read out of
 * a deserialized `ActionResult` — narrower than importing `@sveltejs/kit`'s
 * own type here, so this module stays framework-agnostic and unit-testable
 * with plain object literals. */
export interface ReplayResult {
	readonly type: string;
	readonly status?: number;
	readonly data?: unknown;
}

/**
 * Classifies the outcome of one replay attempt from the `ActionResult`-
 * shaped response `deserialize()` (`$app/forms`) produced for it.
 *
 * - `redirect`/`success`: the server recorded the day — or already had,
 *   from an earlier replay of this same id — so the entry is done and can
 *   be dequeued.
 * - `failure`, or `error` carrying an HTTP status: the request reached
 *   the server and was refused for a real reason (a validation failure, a
 *   constraint, a contract that no longer exists). #62 says this surfaces
 *   to the user rather than vanishing or being retried forever, so it
 *   becomes `rejected`.
 * - `error` with no status: the request never reached the server at all
 *   (`fetch` itself threw — offline, DNS, an aborted connection). The
 *   entry stays queued for the next reconnect.
 */
export function classifyReplay(result: ReplayResult): ReplayOutcome {
	if (result.type === 'redirect' || result.type === 'success') return 'synced';
	if (result.type === 'error' && result.status === undefined) return 'offline';
	return 'rejected';
}

/**
 * The message to show for a `rejected` entry: every field error the
 * action's `fail(400, { errors, values })` returned (see
 * work-unit-form.ts), joined into one sentence. `null` for a rejection
 * that carried no structured field errors — an unexpected 500, say — so
 * the caller can fall back to a generic message instead of showing
 * nothing.
 */
export function extractRejectionMessage(result: ReplayResult): string | null {
	if (result.type !== 'failure') return null;

	const { data } = result;
	if (typeof data !== 'object' || data === null || !('errors' in data)) return null;

	const { errors } = data;
	if (typeof errors !== 'object' || errors === null) return null;

	const messages = Object.values(errors).filter(
		(value): value is string => typeof value === 'string'
	);
	return messages.length > 0 ? messages.join(' ') : null;
}

export type QueueSeverity = 'warning' | 'critical';

/**
 * The escalation `OfflineQueuePanel` already applies per entry (warning
 * while an entry waits or syncs, critical once the server has refused
 * it), lifted to the whole queue for #227's shell-wide indicator: any
 * entry the server has actually rejected makes the aggregate critical,
 * since that is the one status that will not resolve on its own — a
 * `pending`/`syncing` entry is just waiting for a reconnect. Only
 * meaningful for a non-empty queue; callers hide the indicator entirely
 * once `entries.length === 0` rather than calling this with nothing to
 * summarize.
 */
export function queueSeverity(entries: readonly QueuedDay[]): QueueSeverity {
	return entries.some((entry) => entry.status === 'failed') ? 'critical' : 'warning';
}
