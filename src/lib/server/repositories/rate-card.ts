import { asc, eq } from 'drizzle-orm';
import { db, type DbExecutor } from '$lib/server/db';
import {
	rateCard,
	type DisbursementPeriod,
	type RateCardKind,
	type RateUnit
} from '$lib/server/db/schema';

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

export async function getRateCard(id: string) {
	return db.query.rateCard.findFirst({ where: eq(rateCard.id, id) });
}

/** Overlap is rejected by the database (`rate_card_no_overlapping_validity`,
 * a GiST exclusion constraint); a caller that inserts an overlapping period
 * gets a rejected promise back, not a silent acceptance — see
 * `isPostgresConstraintViolation` (`$lib/server/db/postgres-error`) to
 * recognise it (`code: '23P01'`), since drizzle wraps the real Postgres
 * error on `.cause`. */
export async function createRateCard(input: RateCardInput) {
	const [row] = await db.insert(rateCard).values(input).returning();
	return row;
}

export async function updateRateCard(id: string, input: RateCardInput) {
	const [row] = await db.update(rateCard).set(input).where(eq(rateCard.id, id)).returning();
	return row;
}
