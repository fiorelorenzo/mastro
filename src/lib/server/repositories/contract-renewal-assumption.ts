// The database side of #39's renewal assumption: an optional, one-per-
// contract record read and written like every other contract-scoped
// table here (`repositories/clause-note.ts`, `repositories/ceiling.ts`).
// `fiscal/forecast.ts` is the one caller that turns a row from here into
// the pure `RenewalAssumption` shape `fiscal/certainty.ts` computes over
// — this file only ever moves rows, never prices one.

import { eq } from 'drizzle-orm';
import { db, type DbExecutor } from '$lib/server/db';
import { contractRenewalAssumption } from '$lib/server/db/schema';
import type { MinorUnits } from '$lib/money';

export interface ContractRenewalAssumptionInput {
	readonly contractId: string;
	/** 0–1. */
	readonly probability: number;
	readonly expectedVolumeMinorUnits: MinorUnits;
	/** Inclusive ISO date. */
	readonly horizonEndsOn: string;
}

export async function getRenewalAssumptionByContract(
	contractId: string,
	executor: DbExecutor = db
) {
	return executor.query.contractRenewalAssumption.findFirst({
		where: eq(contractRenewalAssumption.contractId, contractId)
	});
}

/**
 * Every recorded assumption, joined to the two fields off its own
 * contract that `fiscal/certainty.ts`'s `renewalAssumptionContribution`
 * needs to anchor it — `endsOn` and `terminationNoticeDays`, the same
 * pair `irrevocabilityWindowEnd` reads everywhere else — plus `title` for
 * a screen to label it with. The query surface a dashboard or a contract
 * detail screen reads to show an assumption's own parameters next to the
 * figure it produces (#39's "visible wherever its output is shown"); see
 * `fiscal/forecast.ts`'s `forecastRenewalAssumptions`, which pairs each
 * row here with that figure through the same pure function the
 * aggregate projected total uses.
 */
export async function listRenewalAssumptionsWithContract(executor: DbExecutor = db) {
	return executor.query.contractRenewalAssumption.findMany({
		with: {
			contract: { columns: { title: true, endsOn: true, terminationNoticeDays: true } }
		}
	});
}

export async function createRenewalAssumption(
	input: ContractRenewalAssumptionInput,
	executor: DbExecutor = db
) {
	const [row] = await executor.insert(contractRenewalAssumption).values(input).returning();
	return row;
}

export async function updateRenewalAssumption(
	id: string,
	input: ContractRenewalAssumptionInput,
	executor: DbExecutor = db
) {
	const [row] = await executor
		.update(contractRenewalAssumption)
		.set(input)
		.where(eq(contractRenewalAssumption.id, id))
		.returning();
	return row;
}

/** Clearing the assumption entirely — the row's absence is what makes
 * the projection beyond the window empty again (#39's acceptance test),
 * so deleting it is the one supported way to withdraw a renewal guess. */
export async function deleteRenewalAssumption(id: string, executor: DbExecutor = db) {
	await executor.delete(contractRenewalAssumption).where(eq(contractRenewalAssumption.id, id));
}
