import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { db, type DbExecutor } from '$lib/server/db';
import {
	approval,
	document,
	workUnit,
	workUnitTransition,
	type TransitionActor
} from '$lib/server/db/schema';

export type WorkUnitInput = {
	contractId: string;
	date: string;
	quantity: number;
	scope: string;
	state?: (typeof workUnit.$inferInsert)['state'];
	approvalId?: string | null;
	notes?: string | null;
};

/**
 * Every write to `work_unit` goes through here so `actor`/`reason` reach
 * `work_unit_log_transition` (`0012_work_unit_state_machine.sql`): they
 * travel as transaction-local settings (`set_config(..., true)`), the only
 * way for a value outside the row itself to reach a trigger body. `run`
 * either executes inside the ambient `tx` a caller already opened, or opens
 * its own — either way `set_config` and the write that follows share one
 * transaction, which `set_config`'s local scoping requires.
 */
async function withActorAndReason<T>(
	tx: DbExecutor | undefined,
	actor: TransitionActor,
	reason: string,
	run: (executor: DbExecutor) => Promise<T>
): Promise<T> {
	const body = async (executor: DbExecutor) => {
		await executor.execute(
			sql`select set_config('mastro.actor', ${JSON.stringify(actor)}, true), set_config('mastro.reason', ${reason}, true)`
		);
		return run(executor);
	};
	return tx ? body(tx) : db.transaction(body);
}

/** Records a new day. `state` defaults to `'proposed'`; passing `'worked'`
 * (e.g. importing a day already known to have been worked) is legal too —
 * see the state machine trigger for the full set of legal insert states —
 * and lands in `worked_without_approval` automatically if the contract
 * requires an approval this call did not supply (#23). */
export async function createWorkUnit(
	input: WorkUnitInput,
	actor: TransitionActor,
	reason: string,
	tx?: DbExecutor
) {
	return withActorAndReason(tx, actor, reason, async (executor) => {
		const [row] = await executor.insert(workUnit).values(input).returning();
		return row;
	});
}

/** Applies `changes` to a day and records why. Illegal transitions and a
 * missing approval on a contract that requires one are rejected by the
 * database (#21), not here — this function does not pre-validate anything
 * the trigger already guards. */
export async function transitionWorkUnit(
	id: string,
	changes: Partial<WorkUnitInput>,
	actor: TransitionActor,
	reason: string,
	tx?: DbExecutor
) {
	return withActorAndReason(tx, actor, reason, async (executor) => {
		const [row] = await executor
			.update(workUnit)
			.set(changes)
			.where(eq(workUnit.id, id))
			.returning();
		return row;
	});
}

/** Links a late approval to a day. On a day currently in
 * `worked_without_approval` this is exactly #23's recovery path: the state
 * machine trigger promotes the row to `worked` on its own the moment
 * `approval_id` is no longer null, and the log records that the day passed
 * through the risk state on its way there. */
export async function linkApprovalToWorkUnit(
	id: string,
	approvalId: string,
	actor: TransitionActor,
	reason: string,
	tx?: DbExecutor
) {
	return transitionWorkUnit(id, { approvalId }, actor, reason, tx);
}

export async function getWorkUnit(id: string, executor: DbExecutor = db) {
	const [row] = await executor.select().from(workUnit).where(eq(workUnit.id, id));
	return row;
}

export async function listWorkUnitTransitions(workUnitId: string, executor: DbExecutor = db) {
	return executor
		.select()
		.from(workUnitTransition)
		.where(eq(workUnitTransition.workUnitId, workUnitId))
		.orderBy(asc(workUnitTransition.createdAt));
}

/** The archived original behind a day's approval, reachable in one query —
 * the other half of #22's "reachable from the day in one click"
 * (`getApprovalDocument` in `repositories/approval.ts` is the forward
 * half, from the approval itself). Null for a day with no linked
 * approval yet. */
export async function getWorkUnitDocument(workUnitId: string, executor: DbExecutor = db) {
	const [row] = await executor
		.select({ document })
		.from(workUnit)
		.innerJoin(approval, eq(workUnit.approvalId, approval.id))
		.innerJoin(document, eq(approval.documentId, document.id))
		.where(eq(workUnit.id, workUnitId));
	return row?.document ?? null;
}

/**
 * #23's alert-engine feed: every transition into the risk state, each with
 * the timestamp it happened. This is the row #74's alert engine is meant
 * to poll — `to_state = 'worked_without_approval'`, ordered by
 * `created_at` — not a second alerting mechanism alongside it.
 * `sinceInclusive` narrows to transitions at or after a given instant, for
 * a poller that only wants what it has not already seen.
 */
export async function listWorkedWithoutApprovalEvents(
	sinceInclusive?: Date,
	executor: DbExecutor = db
) {
	return executor
		.select()
		.from(workUnitTransition)
		.where(
			sinceInclusive
				? and(
						eq(workUnitTransition.toState, 'worked_without_approval'),
						gte(workUnitTransition.createdAt, sinceInclusive)
					)
				: eq(workUnitTransition.toState, 'worked_without_approval')
		)
		.orderBy(asc(workUnitTransition.createdAt));
}

/** The contract most recently recorded on, by insertion time — the day
 * entry form's "contract used most recently" default (#24). `null` when
 * no day has ever been recorded, so the caller falls back to its own
 * default (e.g. the first active contract). */
export async function getMostRecentContractId(executor: DbExecutor = db): Promise<string | null> {
	const [row] = await executor
		.select({ contractId: workUnit.contractId })
		.from(workUnit)
		.orderBy(desc(workUnit.createdAt))
		.limit(1);
	return row?.contractId ?? null;
}

/** Every day whose `date` falls in `[startInclusive, endInclusive]`
 * (ISO dates) — the month calendar's feed (#25). Unordered by contract on
 * purpose: a date can carry more than one day, across different
 * contracts, and the caller groups by date itself. */
export async function listWorkUnitsBetween(
	startInclusive: string,
	endInclusive: string,
	executor: DbExecutor = db
) {
	return executor
		.select()
		.from(workUnit)
		.where(and(gte(workUnit.date, startInclusive), lte(workUnit.date, endInclusive)))
		.orderBy(asc(workUnit.date));
}
