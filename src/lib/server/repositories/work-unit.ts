import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { db, type DbExecutor } from '$lib/server/db';
import {
	approval,
	document,
	workUnit,
	workUnitTransition,
	type TransitionActor
} from '$lib/server/db/schema';

export type WorkUnitInput = {
	// A client-generated uuid (#62's offline queue), or omitted to take the
	// column default. This is the idempotency key a replay of the same
	// queued mutation relies on — see createWorkUnit below for what
	// happens when it names a row that already exists.
	id?: string;
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
 * requires an approval this call did not supply (#23).
 *
 * `input.id`, when supplied, is #62's replay contract: the insert targets
 * a conflict on that column specifically (`ON CONFLICT (id) DO NOTHING`),
 * so resubmitting a mutation the server already recorded once — the
 * offline queue replaying the same client-generated uuid after a
 * connection drop, or before it ever finds out the first attempt
 * succeeded — is a no-op that returns the existing row rather than
 * inserting a second time or raising. Only that one constraint is
 * targeted: a genuine second day for the same contract and date, under a
 * different id, still trips `work_unit_one_active_per_contract_date`
 * exactly as before. Because the conflict suppresses the whole INSERT, the
 * state machine and logging triggers never run a second time either — a
 * replay produces no second `work_unit_transition` row. */
export async function createWorkUnit(
	input: WorkUnitInput,
	actor: TransitionActor,
	reason: string,
	tx?: DbExecutor
) {
	return withActorAndReason(tx, actor, reason, async (executor) => {
		if (!input.id) {
			const [row] = await executor.insert(workUnit).values(input).returning();
			return row;
		}
		const [row] = await executor
			.insert(workUnit)
			.values(input)
			.onConflictDoNothing({ target: workUnit.id })
			.returning();
		if (row) return row;
		const existing = await getWorkUnit(input.id, executor);
		if (!existing) {
			throw new Error(`work_unit ${input.id} conflicted on insert but cannot be found`);
		}
		return existing;
	});
}

/**
 * Creates a day already `approved`, linked to `approvalId`, in the two
 * writes the state machine requires — INSERT can only start a row at
 * `'proposed'`, `'worked'` or `'worked_without_approval'` (#21), never
 * `'approved'` directly, so this inserts `proposed` and immediately
 * transitions it. Both writes share one transaction: a crash between
 * them must never leave a `proposed` day sitting next to evidence that
 * already exists for it. `acceptProposal` (#209) is the caller this
 * exists for — a proposal derived from a written approval already
 * carries the evidence `approved` requires, so accepting one records the
 * day past `proposed` in the same act, leaving only `worked` to a human
 * who actually did it.
 */
export async function createApprovedWorkUnit(
	input: WorkUnitInput,
	approvalId: string,
	actor: TransitionActor,
	reason: string,
	tx?: DbExecutor
) {
	const run = async (executor: DbExecutor) => {
		const created = await createWorkUnit(input, actor, reason, executor);
		return transitionWorkUnit(
			created.id,
			{ state: 'approved', approvalId },
			actor,
			reason,
			executor
		);
	};
	return tx ? run(tx) : db.transaction(run);
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
