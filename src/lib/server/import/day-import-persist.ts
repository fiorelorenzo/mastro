// The only place in the day-import pipeline that writes a `work_unit`
// (#224). Everything upstream (`day-import.ts`) only proposes; nothing
// reaches the ledger until a human confirms the dry run, per invariant 3 —
// mirroring `persist.ts`'s role for an imported invoice.
//
// Every write goes through `createWorkUnit`, the same typed repository
// input `/day/new` and `scripts/seed-demo.ts` already use — never a raw
// insert — so an imported day gets exactly what a typed one gets: the
// state machine trigger, the append-only `work_unit_transition` log, and
// (#23) automatic landing in `worked_without_approval` when the contract
// requires an approval the row did not carry. `reason` names the import by
// filename and row number, so that log entry is how an imported day stays
// distinguishable in its own history from a typed one, without needing a
// column anywhere to say so.
//
// One row's failure never stops the batch — the shape `publishAllPending`
// (`server/drive/publish.ts`) already establishes for mirror publishing,
// and `routes/import/confirm/+server.ts` for an imported invoice. Each row
// commits in its own transaction (or, nested inside a caller's own — a
// test's rolled-back one — its own savepoint, the same trick
// `pg-error.ts`'s `rejection` already relies on): a constraint violation
// on row 12 aborts only row 12's attempt, never rolling back row 11's
// already-committed insert.

import { db, type DbExecutor } from '$lib/server/db';
import type { TransitionActor, WorkUnitState } from '$lib/server/db/schema/work-unit';
import { isPostgresConstraintViolation } from '$lib/server/db/postgres-error';
import { createWorkUnit } from '$lib/server/repositories/work-unit';
import type { DayImportRequestedState } from './day-import';

export interface PersistDayImportRow {
	readonly rowNumber: number;
	readonly contractId: string;
	readonly date: string;
	readonly quantity: number;
	readonly scope: string;
	readonly requestedState: DayImportRequestedState;
}

export type PersistDayImportOutcome =
	| {
			readonly kind: 'created';
			readonly rowNumber: number;
			readonly workUnitId: string;
			readonly state: WorkUnitState;
	  }
	| { readonly kind: 'already_recorded'; readonly rowNumber: number }
	| { readonly kind: 'failed'; readonly rowNumber: number; readonly message: string };

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Persists every row of an accepted dry run, one at a time, in file order.
 * `filename` and each row's own `rowNumber` become the transition log's
 * `reason` (#224's "including a transition-log entry saying it was
 * imported"). A race between review and confirm — another import, or a day
 * typed by hand in between — that lands the exact same contract+date
 * trips `work_unit_one_active_per_contract_date` and comes back as
 * `already_recorded` rather than a raw 500, the same recognition
 * `day-import.ts`'s own dry run already gives a row it saw coming.
 */
export async function persistDayImportBatch(
	rows: readonly PersistDayImportRow[],
	filename: string,
	actor: TransitionActor,
	executor: DbExecutor = db
): Promise<PersistDayImportOutcome[]> {
	const outcomes: PersistDayImportOutcome[] = [];
	for (const row of rows) {
		try {
			const created = await executor.transaction((nested) =>
				createWorkUnit(
					{
						contractId: row.contractId,
						date: row.date,
						quantity: row.quantity,
						scope: row.scope,
						state: row.requestedState
					},
					actor,
					`imported from ${filename}, row ${row.rowNumber}`,
					nested
				)
			);
			outcomes.push({
				kind: 'created',
				rowNumber: row.rowNumber,
				workUnitId: created.id,
				state: created.state
			});
		} catch (error) {
			if (isPostgresConstraintViolation(error, '23505', 'work_unit_one_active_per_contract_date')) {
				outcomes.push({ kind: 'already_recorded', rowNumber: row.rowNumber });
			} else {
				outcomes.push({ kind: 'failed', rowNumber: row.rowNumber, message: errorMessage(error) });
			}
		}
	}
	return outcomes;
}
