import { and, asc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
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
	// Set when a line bills this day (#26); the state machine trigger is
	// what actually enforces that only a legal transition (worked/disputed
	// -> invoiced) may accompany it — this type does not pre-validate that.
	invoiceLineId?: string | null;
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

/**
 * Days a contract can still bill: `worked` or `disputed` (both carry the
 * `-> invoiced` edge the state machine allows) with no line already
 * covering them. This is the picker `routes/invoices/new` builds an
 * invoice's lines from (#26) — a day proposed, approved but not yet
 * worked, or already invoiced, is never offered.
 */
export async function listEligibleWorkUnitsForInvoicing(
	contractId: string,
	executor: DbExecutor = db
) {
	return executor
		.select()
		.from(workUnit)
		.where(
			and(
				eq(workUnit.contractId, contractId),
				inArray(workUnit.state, ['worked', 'disputed']),
				isNull(workUnit.invoiceLineId)
			)
		)
		.orderBy(asc(workUnit.date));
}
