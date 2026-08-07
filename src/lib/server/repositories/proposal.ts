// #83: the only place a `proposal` row is written or decided. Producing
// one (#85, #86, #87 — none of which exist yet) is `createProposal` and
// nothing more: a producer supplies `documentId`, `contractId`,
// `targetType`, `proposedFields` shaped for that target type (see
// `applyProposal` below for what each currently-supported type expects),
// `excerpt` and `confidence`. Everything after that — editing, accepting,
// rejecting — is a human decision made on the review screen
// (`routes/proposals`), never the producer's.
//
// Accepting is the "no bypass" half of invariant 3: it does not insert a
// row directly, it calls the same repository function (`createWorkUnit`,
// today) a human's own form submission calls, inside one transaction with
// the proposal's own status update. A rejected write there — a database
// constraint a manual entry would also trip — rolls the whole thing back,
// proposal included, so a proposal can never end up marked `accepted` next
// to a row that was never actually written. `proposal.test.ts` proves this
// both ways: a valid proposal produces exactly what a human's own entry
// would, and an invalid one produces nothing at all, in either case.

import { desc, eq } from 'drizzle-orm';
import { db, type DbExecutor } from '$lib/server/db';
import { proposal, type ProposalStatus, type ProposalTargetType } from '$lib/server/db/schema';
import { createWorkUnit, type WorkUnitInput } from './work-unit';

export type ProposalRow = typeof proposal.$inferSelect;

export type ProposalInput = {
	documentId: string;
	contractId: string;
	targetType: ProposalTargetType;
	proposedFields: Record<string, unknown>;
	excerpt: string;
	confidence: number;
};

export async function createProposal(input: ProposalInput, executor: DbExecutor = db) {
	const [row] = await executor.insert(proposal).values(input).returning();
	return row;
}

export async function getProposal(id: string, executor: DbExecutor = db) {
	const [row] = await executor.select().from(proposal).where(eq(proposal.id, id));
	return row;
}

/** Every proposal, most recent first, optionally narrowed to one status —
 * the review queue's feed (pending) and its decided history (accepted or
 * rejected) are the same query with a different filter. */
export async function listProposals(status: ProposalStatus | undefined, executor: DbExecutor = db) {
	return status
		? executor
				.select()
				.from(proposal)
				.where(eq(proposal.status, status))
				.orderBy(desc(proposal.createdAt))
		: executor.select().from(proposal).orderBy(desc(proposal.createdAt));
}

/**
 * Maps a `'work_unit'` proposal's fields onto `WorkUnitInput`, the same
 * type `work-unit-form.ts` builds from a human's own day-entry submission.
 * A producer targeting `'work_unit'` supplies `proposedFields` as
 * `{ date: string, quantity: number, scope: string, notes?: string }` —
 * `contractId` is never duplicated inside the JSON blob, it is read off
 * `proposal.contractId` itself. `state` always starts `'proposed'`:
 * accepting this proposal records the day, it does not also approve it —
 * whether accepting a day proposal from an approval thread should also
 * create the `approval` row it rests on is #85's decision, not this one's
 * (see #81's comment on that issue).
 */
function workUnitInputFromFields(
	row: Pick<ProposalRow, 'contractId'>,
	fields: Record<string, unknown>
): WorkUnitInput {
	const { date, quantity, scope, notes } = fields;
	if (typeof date !== 'string') throw new Error("proposal field 'date' must be a string");
	if (typeof quantity !== 'number') throw new Error("proposal field 'quantity' must be a number");
	if (typeof scope !== 'string') throw new Error("proposal field 'scope' must be a string");
	if (notes !== undefined && notes !== null && typeof notes !== 'string') {
		throw new Error("proposal field 'notes' must be a string when present");
	}
	return { contractId: row.contractId, date, quantity, scope, notes: notes ?? null };
}

/**
 * Writes the row `row`'s target type produces, through that type's own
 * repository function and its own database triggers — the literal
 * mechanism behind invariant 3's "no bypass". Returns the new row's id, to
 * record on `proposal.resultId`.
 *
 * A `switch` with no `default`, not an if/else: `row.targetType` is typed
 * `ProposalTargetType`, so widening that union (#86 adding `'contract'`,
 * #87 adding `'invoice'`) without adding the matching case here fails to
 * compile, the same guarantee `no-country-logic.test.ts` gives the fiscal
 * packs a different way.
 */
async function applyProposal(
	row: ProposalRow,
	fields: Record<string, unknown>,
	executor: DbExecutor
): Promise<string> {
	switch (row.targetType) {
		case 'work_unit': {
			const created = await createWorkUnit(
				workUnitInputFromFields(row, fields),
				{ kind: 'agent', proposalReference: row.id },
				`accepted from proposal ${row.id}`,
				executor
			);
			return created.id;
		}
	}
}

export type AcceptProposalInput = {
	/** Overrides onto the proposed fields — present only for the fields the
	 * reviewer actually changed. Merged onto `proposedFields` to produce
	 * `acceptedFields`; an empty or omitted object means the proposal was
	 * accepted exactly as proposed. */
	edits?: Record<string, unknown>;
	/** The reviewer's own email — who accepted, distinct from
	 * `resultId`'s row itself recording `{kind: 'agent', proposalReference}`
	 * as the provenance of its *values*. */
	decidedBy: string;
};

/**
 * Accepts a pending proposal: merges `edits` onto `proposedFields`, writes
 * the target row through `applyProposal`, and records the decision, all in
 * one transaction. If the target write is rejected by a database
 * constraint — the same constraint a human's own entry would trip — the
 * whole transaction rolls back and the proposal is left exactly as it was,
 * still `pending`: an accept attempt that fails produces neither a ledger
 * row nor a false `accepted` record.
 */
export async function acceptProposal(
	id: string,
	input: AcceptProposalInput,
	tx?: DbExecutor
): Promise<ProposalRow> {
	const run = async (executor: DbExecutor): Promise<ProposalRow> => {
		const row = await getProposal(id, executor);
		if (!row) throw new Error(`proposal ${id} not found`);
		if (row.status !== 'pending') {
			throw new Error(`proposal ${id} has already been decided (${row.status})`);
		}

		const acceptedFields = { ...row.proposedFields, ...(input.edits ?? {}) };
		const resultId = await applyProposal(row, acceptedFields, executor);

		const [updated] = await executor
			.update(proposal)
			.set({
				status: 'accepted',
				acceptedFields,
				resultId,
				decidedBy: input.decidedBy,
				decidedAt: new Date()
			})
			.where(eq(proposal.id, id))
			.returning();
		return updated;
	};
	return tx ? run(tx) : db.transaction(run);
}

/** Rejects a pending proposal. Writes nothing to any other table — a
 * rejected proposal is only ever a decided row here, never a ledger entry
 * of any kind. */
export async function rejectProposal(
	id: string,
	decidedBy: string,
	tx?: DbExecutor
): Promise<ProposalRow> {
	const run = async (executor: DbExecutor): Promise<ProposalRow> => {
		const row = await getProposal(id, executor);
		if (!row) throw new Error(`proposal ${id} not found`);
		if (row.status !== 'pending') {
			throw new Error(`proposal ${id} has already been decided (${row.status})`);
		}
		const [updated] = await executor
			.update(proposal)
			.set({ status: 'rejected', decidedBy, decidedAt: new Date() })
			.where(eq(proposal.id, id))
			.returning();
		return updated;
	};
	return tx ? run(tx) : db.transaction(run);
}

export interface ProposalFieldChange {
	readonly field: string;
	readonly proposed: unknown;
	readonly accepted: unknown;
}

/**
 * Every field whose accepted value differs from what was proposed — #83's
 * acceptance criterion made concrete: "the diff between proposed and
 * accepted is the only honest measure of whether the agent is getting
 * better or worse." Computed on read from the two blobs `proposal` already
 * keeps forever, rather than stored as its own column, so it can never go
 * stale relative to them. Empty for a proposal accepted with no edits, and
 * always empty for one that is still pending or was rejected (no
 * `acceptedFields` to compare against).
 */
export function diffProposalFields(row: {
	proposedFields: Record<string, unknown>;
	acceptedFields: Record<string, unknown> | null;
}): ProposalFieldChange[] {
	if (!row.acceptedFields) return [];
	const accepted = row.acceptedFields;
	const fields = new Set([...Object.keys(row.proposedFields), ...Object.keys(accepted)]);
	const changes: ProposalFieldChange[] = [];
	for (const field of fields) {
		const proposedValue = row.proposedFields[field];
		const acceptedValue = accepted[field];
		if (JSON.stringify(proposedValue) !== JSON.stringify(acceptedValue)) {
			changes.push({ field, proposed: proposedValue, accepted: acceptedValue });
		}
	}
	return changes.sort((a, b) => a.field.localeCompare(b.field));
}
