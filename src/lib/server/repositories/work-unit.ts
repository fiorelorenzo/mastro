import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, sql } from 'drizzle-orm';
import { db, type DbExecutor } from '$lib/server/db';
import {
	approval,
	contract,
	document,
	invoice,
	invoiceLine,
	workUnit,
	workUnitTransition,
	type TransitionActor
} from '$lib/server/db/schema';
import type { WorkUnitState } from '$lib/server/db/schema/work-unit';

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

/** #228's other exit from the risk state: a day nobody will ever approve,
 * closed out as `unbillable` instead of waiting forever for a late
 * approval that is not coming. Same shape as `linkApprovalToWorkUnit` —
 * one field through `transitionWorkUnit` — except the field changing is
 * `state` itself; the trigger's allowed-edge list
 * (`worked_without_approval -> unbillable`, 0012_work_unit_state_machine.sql)
 * is what actually enforces this is only reachable from the risk state,
 * so a day anywhere else is rejected by the database, not by this
 * function. `reason` is what the person closing it out gave — never
 * optional in the caller, since "why will this never be approved" is the
 * entire point of the log entry it produces. */
export async function markWorkUnitUnbillable(
	id: string,
	actor: TransitionActor,
	reason: string,
	tx?: DbExecutor
) {
	return transitionWorkUnit(id, { state: 'unbillable' }, actor, reason, tx);
}

/**
 * The edge the product was missing (#417's successor). `work_unit_enforce_state_machine`
 * has always allowed `approved -> worked`; nothing in the application ever called it,
 * so an accepted proposal parked a day at `approved` and `listEligibleWorkUnitsForInvoicing`
 * — which reads `worked` and `disputed` — could never see it. Recording every day by hand
 * was the only road that arrived.
 *
 * Same shape as its six siblings: one field through `transitionWorkUnit`, and
 * an illegal source state is refused by the database rather than by a check
 * here. `actor` is `{ kind: 'system' }` when the settle sweep applies it and
 * `{ kind: 'human', email }` when somebody presses the button on the day
 * itself; `reason` is never optional, because the append-only log is what
 * makes an automatic transition readable afterwards.
 */
export async function markWorkUnitWorked(
	id: string,
	actor: TransitionActor,
	reason: string,
	tx?: DbExecutor
) {
	return transitionWorkUnit(id, { state: 'worked' }, actor, reason, tx);
}

/** #214's path in: a client contests an already-billed day. Same shape as
 * `markWorkUnitUnbillable` — one field through `transitionWorkUnit` —
 * except the trigger's allowed-edge list only admits this from `invoiced`
 * (`0038_work_unit_approved_to_risk_edge.sql`), so a day still `worked`,
 * or already `paid`, is rejected by the database, not by this function.
 * `reason` is the client's own objection — never optional in the caller,
 * since that is what the log entry and the evidence bundle (#214) exist
 * to carry forward. */
export async function disputeWorkUnit(
	id: string,
	actor: TransitionActor,
	reason: string,
	tx?: DbExecutor
) {
	return transitionWorkUnit(id, { state: 'disputed' }, actor, reason, tx);
}

/** #214's way out: the argument is settled and the day returns to
 * `invoiced`, at whatever quantity or scope was ultimately agreed —
 * neither is touched here, only the state and why it changed back. Legal
 * only from `disputed` (`'disputed' -> 'invoiced'`), the same edge the
 * register already relies on to still call a disputed day "billed". */
export async function resolveWorkUnitDispute(
	id: string,
	actor: TransitionActor,
	reason: string,
	tx?: DbExecutor
) {
	return transitionWorkUnit(id, { state: 'invoiced' }, actor, reason, tx);
}

/** #370: the client withdrew an approval before the day was worked, so it
 * stops being billable. Legal only from `approved` (`'approved' ->
 * 'revoked'`) — the trigger enforces that. Unlike `markWorkUnitUnbillable`/
 * `disputeWorkUnit`, the day detail page collects no free-text reason for
 * this one: the evidence for *why* is the approval itself, which stays
 * archived and linked (AGENTS.md's "every derived datum keeps its source
 * document"), not a second explanation typed into a form that would only
 * duplicate it. `reason` here is the fixed string the route passes, kept
 * as a parameter rather than hard-coded so a future caller (an import, an
 * agent) can still say why in its own words. */
export async function revokeWorkUnit(
	id: string,
	actor: TransitionActor,
	reason: string,
	tx?: DbExecutor
) {
	return transitionWorkUnit(id, { state: 'revoked' }, actor, reason, tx);
}

/** #370: a proposed day that never took place. Legal only from `proposed`
 * (`'proposed' -> 'rejected'`) — the trigger enforces that. Same reasoning
 * as `revokeWorkUnit` above for carrying no free-text reason from the UI:
 * the evidence is the source document the proposal rested on, already
 * archived, never a fresh explanation typed here. */
export async function rejectWorkUnit(
	id: string,
	actor: TransitionActor,
	reason: string,
	tx?: DbExecutor
) {
	return transitionWorkUnit(id, { state: 'rejected' }, actor, reason, tx);
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
		.orderBy(asc(workUnitTransition.seq));
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

/** The invoice line a day landed on, with its parent invoice, reachable in
 * one query (#237's "the invoice line it landed on"). `null` for a day
 * with no `invoiceLineId` yet — every state before `invoiced`, and the
 * risk state, which never bills until it resolves. */
export async function getWorkUnitInvoiceLine(workUnitId: string, executor: DbExecutor = db) {
	const [row] = await executor
		.select({ invoiceLine, invoice })
		.from(workUnit)
		.innerJoin(invoiceLine, eq(workUnit.invoiceLineId, invoiceLine.id))
		.innerJoin(invoice, eq(invoiceLine.invoiceId, invoice.id))
		.where(eq(workUnit.id, workUnitId));
	return row ?? null;
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

/**
 * Whether a contract has any day recorded at all, in any state. The
 * invoice form (#372) needs this alongside `listEligibleWorkUnitsForInvoicing`
 * to tell apart a fresh contract with nothing recorded yet ("record a
 * day"), from one whose days exist but are all ineligible to bill:
 * `worked_without_approval`, still `proposed`/`approved`, or already
 * `invoiced`. That distinction owes the reader the excluding condition,
 * not a pointer at the entry form they already used. Selects only `id`
 * and stops at the first row, since the form only needs emptiness, not
 * the rows `listWorkUnitsForContract` fetches for the contract detail
 * feed.
 */
export async function hasAnyWorkUnitForContract(
	contractId: string,
	executor: DbExecutor = db
): Promise<boolean> {
	const [row] = await executor
		.select({ id: workUnit.id })
		.from(workUnit)
		.where(eq(workUnit.contractId, contractId))
		.limit(1);
	return row !== undefined;
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

/**
 * The days already recorded on one contract for one date (#417).
 *
 * What `/day/new` asks before it lets somebody record a second one. Two
 * days on one date is legal - different activities happen, and `quantity`
 * plus `scope` say which - so this warns rather than forbidding, and there
 * is deliberately no unique constraint behind it. But a duplicated day is a
 * duplicated invoice line, which is the most expensive mistake this product
 * can make on the path it is fastest on, so the form has to know.
 *
 * One pair, not a table: the date is a client-side input, so the answer is
 * fetched when it changes rather than shipped whole.
 */
export async function listWorkUnitsForContractOnDate(
	contractId: string,
	date: string,
	executor: DbExecutor = db
) {
	return executor
		.select()
		.from(workUnit)
		.where(and(eq(workUnit.contractId, contractId), eq(workUnit.date, date)))
		.orderBy(asc(workUnit.createdAt));
}

/**
 * Every day still `approved` whose date is strictly before `date` — the
 * settle sweep's own read (`$lib/server/days/settle.ts`).
 *
 * Strictly before, never on: a day must not become billable while it is
 * still in progress. `date` is the sweep's idea of today, passed in rather
 * than read from the clock here, so a test can name the boundary and a
 * future timezone decision has one place to change.
 */
export async function listApprovedDaysBefore(date: string, executor: DbExecutor = db) {
	return executor
		.select({ id: workUnit.id, date: workUnit.date })
		.from(workUnit)
		.where(and(eq(workUnit.state, 'approved'), lt(workUnit.date, date)))
		.orderBy(asc(workUnit.date));
}

/**
 * Every state a day passes through once it has actually happened: `worked`
 * itself, its at-risk cousin `worked_without_approval`, every state
 * downstream of billing (`invoiced`, `paid`, `disputed`), and `unbillable`
 * (worked, just never recovered an approval — see the state diagram atop
 * this schema). `proposed`/`approved` have not happened yet; `rejected`/
 * `revoked` never did — excluded on purpose, the same distinction
 * `repositories/register.ts`'s own `BILLED_STATES` draws for "ever
 * billed", one step narrower than what this needs.
 */
const WORKED_STATES: readonly WorkUnitState[] = [
	'worked',
	'worked_without_approval',
	'invoiced',
	'paid',
	'disputed',
	'unbillable'
];

/**
 * How many days actually happened for each client over `[from, to)`
 * (#242's "days this year") — grouped by client through the day's own
 * contract, counting rows the same way `listUnpaidInvoices`'s own
 * `dayCount` does rather than summing `quantity`, so a half day and a
 * full day both read as "a day" here, consistently with that existing
 * column.
 */
export async function countWorkedDaysByClientForYear(
	from: string,
	toExclusive: string,
	executor: DbExecutor = db
) {
	return executor
		.select({
			clientId: contract.clientId,
			days: sql<number>`count(${workUnit.id})`.mapWith(Number)
		})
		.from(workUnit)
		.innerJoin(contract, eq(contract.id, workUnit.contractId))
		.where(
			and(
				gte(workUnit.date, from),
				lt(workUnit.date, toExclusive),
				inArray(workUnit.state, WORKED_STATES)
			)
		)
		.groupBy(contract.clientId);
}

/** Every day ever recorded against a contract, most recent first — the
 * contract detail page's own "what has this contract produced" feed
 * (#240). Unlike `listEligibleWorkUnitsForInvoicing`'s narrow slice this
 * keeps every state, including the ones a day never bills from
 * (`proposed`, `rejected`, `revoked`) — the page shows what happened,
 * not just what is still actionable. `createdAt` breaks a same-date tie
 * deterministically rather than leaving it to the database's own
 * incidental order. */
export async function listWorkUnitsForContract(contractId: string, executor: DbExecutor = db) {
	return executor
		.select()
		.from(workUnit)
		.where(eq(workUnit.contractId, contractId))
		.orderBy(desc(workUnit.date), desc(workUnit.createdAt));
}
