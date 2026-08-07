// The database side of certainty (#38): fetches approved days and
// recurring-fee schedules and hands them, alongside the ledger
// (`revenue.ts`), to the pure functions in `certainty.ts`. Accepts either
// the pool or an open transaction (`DbExecutor`), same as `revenue.ts`.

import { and, eq, isNull } from 'drizzle-orm';
import { db, type DbExecutor } from '$lib/server/db';
import { contract, rateCard, workUnit } from '$lib/server/db/schema';
import { decimalStringToMinorUnits } from '$lib/server/import/decimal';
import { priceWorkUnitOnDate } from '$lib/server/domain/work-unit-pricing';
import { recurringFeeOccurrences, type RecurringFeeCard } from '$lib/server/domain/recurring-fee';
import { listRenewalAssumptionsWithContract } from '$lib/server/repositories/contract-renewal-assumption';
import { fetchLedgerRows } from './revenue';
import type { MinorUnits } from './pack';
import {
	certaintyBreakdown,
	collectedAmount,
	committedAmount,
	projectedAmount,
	renewalAssumptionContribution,
	type ApprovedWorkUnit,
	type CertaintyBreakdown,
	type CertaintyFigure,
	type RecurringFeeContract,
	type RenewalAssumption
} from './certainty';

/**
 * `priceRateCard`/`priceWorkUnitOnDate` price in whole currency units,
 * matching `rate_card.amount`'s own column type (see the module comment
 * on `domain/rate-card.ts`). Every certainty figure, like every other
 * money figure in `fiscal/`, is `MinorUnits` — this is the one place that
 * conversion happens, through the same string-based rounding
 * `decimalStringToMinorUnits` already uses for every other amount a human
 * or a document supplies, never a second hand-rolled `* 100`.
 */
function toMinorUnits(majorUnits: number): number {
	return decimalStringToMinorUnits(majorUnits.toFixed(2));
}

/** Every day currently `approved` and not yet on an invoice line, priced
 * against its own contract's rate cards, restricted to `[from, to)`. */
async function fetchApprovedWorkUnits(
	from: string,
	to: string,
	executor: DbExecutor
): Promise<ApprovedWorkUnit[]> {
	const rows = await executor
		.select()
		.from(workUnit)
		.where(and(eq(workUnit.state, 'approved'), isNull(workUnit.invoiceLineId)));

	const contractIds = [...new Set(rows.map((row) => row.contractId))];
	const rateCardsByContract = new Map(
		await Promise.all(
			contractIds.map(async (contractId) => {
				const cards = await executor
					.select()
					.from(rateCard)
					.where(eq(rateCard.contractId, contractId));
				return [contractId, cards] as const;
			})
		)
	);

	return rows
		.filter((row) => row.date >= from && row.date < to)
		.map((row) => {
			const amount = priceWorkUnitOnDate(
				{ date: row.date, quantity: Number(row.quantity) },
				rateCardsByContract.get(row.contractId) ?? []
			);
			return { date: row.date, amount: amount === null ? null : toMinorUnits(amount) };
		});
}

/** Every contract's recurring-fee schedule, expanded into occurrences over
 * `[from, to)` — the raw material `committedAmount`/`projectedAmount`
 * split by the irrevocability window. */
async function fetchRecurringFeeContracts(
	from: string,
	to: string,
	executor: DbExecutor
): Promise<RecurringFeeContract[]> {
	const [contractRows, assumptionRows] = await Promise.all([
		executor.select().from(contract),
		listRenewalAssumptionsWithContract(executor)
	]);
	// Keyed here rather than joined per-contract below: one query for
	// every recorded assumption, same reasoning as the rate-card fetch
	// beneath it batching by contract id instead of querying per row.
	const assumptionByContract = new Map(
		assumptionRows.map((row) => [
			row.contractId,
			{
				probability: row.probability,
				expectedVolumeMinorUnits: row.expectedVolumeMinorUnits,
				horizonEndsOn: row.horizonEndsOn
			} satisfies RenewalAssumption
		])
	);

	return Promise.all(
		contractRows.map(async (row) => {
			const cards = (
				await executor.select().from(rateCard).where(eq(rateCard.contractId, row.id))
			).filter((card): card is typeof card & RecurringFeeCard => card.kind === 'fixed_recurring');

			const occurrences = cards.flatMap((card) =>
				recurringFeeOccurrences(card, from, to).map((o) => ({
					date: o.date,
					amount: toMinorUnits(o.amount)
				}))
			);

			return {
				contractId: row.id,
				terminationNoticeDays: row.terminationNoticeDays,
				endsOn: row.endsOn,
				occurrences,
				renewalAssumption: assumptionByContract.get(row.id) ?? null
			};
		})
	);
}

/**
 * Every recorded renewal assumption (#39), each paired with the exact
 * figure it produced over `[from, to)` through
 * `renewalAssumptionContribution` — the same function the aggregate
 * `projectedAmount` total above runs through for the same contract,
 * never a second calculation. The query surface a screen reads to show
 * an assumption's own probability, expected volume and horizon directly
 * next to the number it produced: one entry per contract that has an
 * assumption recorded, every other contract simply absent — #39's
 * "visible wherever its output is shown".
 */
export interface ContractRenewalAssumptionForecast {
	readonly contractId: string;
	readonly contractTitle: string;
	readonly assumption: RenewalAssumption;
	readonly contribution: MinorUnits;
}

export async function forecastRenewalAssumptions(
	asOfDate: string,
	from: string,
	to: string,
	executor: DbExecutor = db
): Promise<ContractRenewalAssumptionForecast[]> {
	const rows = await listRenewalAssumptionsWithContract(executor);
	return rows.map((row) => {
		const assumption: RenewalAssumption = {
			probability: row.probability,
			expectedVolumeMinorUnits: row.expectedVolumeMinorUnits,
			horizonEndsOn: row.horizonEndsOn
		};
		const contribution = renewalAssumptionContribution(
			{
				terminationNoticeDays: row.contract.terminationNoticeDays,
				endsOn: row.contract.endsOn,
				occurrences: [],
				renewalAssumption: assumption
			},
			asOfDate,
			from,
			to
		);
		return {
			contractId: row.contractId,
			contractTitle: row.contract.title,
			assumption,
			contribution
		};
	});
}

/** All three certainty levels over `[from, to)`, as of `asOfDate` (#38).
 * The query surface a dashboard reads: `forecastRevenue` for the full
 * breakdown, or the underlying `fiscal/certainty.ts` functions directly
 * when only one level is needed. */
export async function forecastRevenue(
	asOfDate: string,
	from: string,
	to: string,
	executor: DbExecutor = db
): Promise<CertaintyBreakdown> {
	const [rows, approvedWorkUnits, recurringContracts] = await Promise.all([
		fetchLedgerRows(executor),
		fetchApprovedWorkUnits(from, to, executor),
		fetchRecurringFeeContracts(from, to, executor)
	]);
	return certaintyBreakdown(rows, approvedWorkUnits, recurringContracts, asOfDate, from, to);
}

/** Collected alone — money in the bank over `[from, to)`. */
export async function forecastCollected(
	from: string,
	to: string,
	executor: DbExecutor = db
): Promise<CertaintyFigure> {
	return collectedAmount(await fetchLedgerRows(executor), from, to);
}

/** Committed alone — issued unpaid invoices, approved not-yet-invoiced
 * days, and recurring fees inside the irrevocability window. */
export async function forecastCommitted(
	asOfDate: string,
	from: string,
	to: string,
	executor: DbExecutor = db
): Promise<CertaintyFigure> {
	const [rows, approvedWorkUnits, recurringContracts] = await Promise.all([
		fetchLedgerRows(executor),
		fetchApprovedWorkUnits(from, to, executor),
		fetchRecurringFeeContracts(from, to, executor)
	]);
	return committedAmount(rows, approvedWorkUnits, recurringContracts, asOfDate, from, to);
}

/** Projected alone — recurring fees beyond the irrevocability window, up
 * to each contract's own end date. */
export async function forecastProjected(
	asOfDate: string,
	from: string,
	to: string,
	executor: DbExecutor = db
): Promise<CertaintyFigure> {
	const recurringContracts = await fetchRecurringFeeContracts(from, to, executor);
	return projectedAmount(recurringContracts, asOfDate, from, to);
}
