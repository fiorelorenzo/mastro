import { asc, eq, inArray } from 'drizzle-orm';
import { db, type DbExecutor } from '$lib/server/db';
import {
	rateCard,
	type DisbursementPeriod,
	type RateCardKind,
	type RateUnit
} from '$lib/server/db/schema';

export type RateCardRow = typeof rateCard.$inferSelect;

export type RateCardInput = {
	contractId: string;
	validFrom: string;
	validTo: string | null;
	kind: RateCardKind;
	amount: number;
	unit: RateUnit;
	allowedFractions: number[];
	minimumHours: number | null;
	disbursementPeriod: DisbursementPeriod | null;
};

export async function listRateCards(contractId: string, executor: DbExecutor = db) {
	return executor.query.rateCard.findMany({
		where: eq(rateCard.contractId, contractId),
		orderBy: asc(rateCard.validFrom)
	});
}

/** Batched `listRateCards` (#307): every rate card for any of
 * `contractIds`, in one query — the review queue's loaders collect the
 * distinct contract ids across a page of proposals, group this by
 * `contractId` into a map, and let `priceWorkUnitOnDate` read from it
 * instead of a `listRateCards` call per row. Empty input skips the round
 * trip rather than sending `WHERE contract_id IN ()`, which Postgres
 * rejects. Ordered the same as `listRateCards`, oldest validity first
 * within each contract, since callers group without re-sorting. */
export async function listRateCardsForContracts(
	contractIds: readonly string[],
	executor: DbExecutor = db
) {
	if (contractIds.length === 0) return [];
	return executor.query.rateCard.findMany({
		where: inArray(rateCard.contractId, contractIds),
		orderBy: asc(rateCard.validFrom)
	});
}

export async function getRateCard(id: string) {
	return db.query.rateCard.findFirst({ where: eq(rateCard.id, id) });
}

/** Overlap is rejected by the database (`rate_card_no_overlapping_validity`,
 * a GiST exclusion constraint); a caller that inserts an overlapping period
 * gets a rejected promise back, not a silent acceptance — see
 * `isPostgresConstraintViolation` (`$lib/server/db/postgres-error`) to
 * recognise it (`code: '23P01'`), since drizzle wraps the real Postgres
 * error on `.cause`. */
export async function createRateCard(input: RateCardInput, executor: DbExecutor = db) {
	const [row] = await executor.insert(rateCard).values(input).returning();
	return row;
}

export async function updateRateCard(id: string, input: RateCardInput) {
	const [row] = await db.update(rateCard).set(input).where(eq(rateCard.id, id)).returning();
	return row;
}
