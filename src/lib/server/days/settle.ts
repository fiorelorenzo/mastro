import { db, type DbExecutor } from '$lib/server/db';
import { listApprovedDaysBefore, markWorkUnitWorked } from '$lib/server/repositories/work-unit';

export interface SettleOutcome {
	readonly settled: number;
	readonly failed: number;
}

/**
 * Records every approved day whose date has passed as `worked`.
 *
 * This is the join the product was missing. Accepting a proposal writes a
 * day at `approved` and nothing moved it on, so it could never be invoiced
 * and the only road to a billable day was recording it by hand — the step
 * that felt slow was the only one that arrived.
 *
 * The rule is deliberately narrow. Only `approved` is touched: a `proposed`
 * day carries nobody's agreement, `worked_without_approval` is already its
 * own honest state, and revoked, rejected and unbillable are decisions a
 * sweep has no business revisiting. The database's allowed-edge list refuses
 * everything else anyway, which is why there is no state check here.
 *
 * `today` is passed in, not read from a clock, so the boundary is testable
 * and a timezone decision has one place to land. The caller computes it in
 * UTC: being late is safe, being early is not.
 *
 * One day's failure does not stop the rest — the same "one bad row does not
 * stop the batch" shape the mirror and the alert engine use. A failure here
 * means the database refused a transition it had allowed a moment earlier,
 * which is worth surfacing as a count rather than a thrown sweep.
 */
export async function settleApprovedDays(
	today: string,
	executor: DbExecutor = db
): Promise<SettleOutcome> {
	const due = await listApprovedDaysBefore(today, executor);
	let settled = 0;
	let failed = 0;
	for (const day of due) {
		try {
			await markWorkUnitWorked(
				day.id,
				{ kind: 'system' },
				'the day passed with its approval on file',
				executor
			);
			settled += 1;
		} catch {
			failed += 1;
		}
	}
	return { settled, failed };
}

/** Today in UTC, as an ISO date. The sweep's own boundary, named so the
 * route and the tests agree on it. */
export function utcToday(now: Date = new Date()): string {
	return now.toISOString().slice(0, 10);
}
