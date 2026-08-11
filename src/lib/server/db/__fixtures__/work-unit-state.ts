import { eq } from 'drizzle-orm';
import type { DbExecutor } from '$lib/server/db';
import { workUnit, type WorkUnitState } from '$lib/server/db/schema';

/**
 * Puts a day in `state` the way the product does: by walking the legal
 * edges, not by inserting there.
 *
 * The state machine (`drizzle/0012_work_unit_state_machine.sql`) only lets
 * an INSERT start at `proposed`, `worked` or `worked_without_approval`, and
 * only lets an UPDATE follow an edge the graph contains. A test that seeds
 * `state: 'approved'` directly is rejected by the database — and dozens
 * did, silently, because the rolled-back-transaction pattern swallowed the
 * error and the test passed having exercised nothing (#191).
 *
 * `approvalId` is required for `approved` and beyond on a contract that
 * requires prior approval, which is the same rule a human's own entry
 * meets. `invoiceLineId` is required for `invoiced` and `paid`.
 */
const PATH: Record<string, readonly WorkUnitState[]> = {
	proposed: [],
	approved: ['approved'],
	worked: ['approved', 'worked'],
	invoiced: ['approved', 'worked', 'invoiced'],
	paid: ['approved', 'worked', 'invoiced', 'paid'],
	rejected: ['rejected'],
	revoked: ['approved', 'revoked'],
	unbillable: ['unbillable']
};

export interface SeedDayInput {
	readonly contractId: string;
	readonly date: string;
	readonly quantity?: number;
	readonly scope?: string;
	readonly state: WorkUnitState;
	readonly approvalId?: string | null;
	readonly invoiceLineId?: string | null;
}

export async function seedDayInState(tx: DbExecutor, input: SeedDayInput) {
	// `worked_without_approval` and `worked` can be inserted outright; every
	// other state is reached by walking. `unbillable` is only reachable from
	// `worked_without_approval`, so that is where its walk starts.
	const insertState: WorkUnitState =
		input.state === 'worked_without_approval' || input.state === 'unbillable'
			? 'worked_without_approval'
			: 'proposed';

	const [row] = await tx
		.insert(workUnit)
		.values({
			contractId: input.contractId,
			date: input.date,
			quantity: input.quantity ?? 1,
			scope: input.scope ?? 'work',
			state: insertState
		})
		.returning();

	if (input.state === insertState) return row;

	const walk = input.state === 'unbillable' ? (['unbillable'] as const) : PATH[input.state];
	if (!walk) throw new Error(`no legal path to ${input.state}`);

	let current = row;
	for (const next of walk) {
		const [updated] = await tx
			.update(workUnit)
			.set({
				state: next,
				...(next === 'approved' && input.approvalId ? { approvalId: input.approvalId } : {}),
				...(next === 'invoiced' && input.invoiceLineId
					? { invoiceLineId: input.invoiceLineId }
					: {})
			})
			.where(eq(workUnit.id, current.id))
			.returning();
		current = updated;
	}
	return current;
}
