// Certainty levels (#38), as epic #5 defines them: collected, committed
// and projected, "used everywhere a future number appears". All three are
// pure functions over already-fetched data — `fiscal/forecast.ts` is
// where the database is actually read — so every figure here is
// hand-verifiable against a fixture built in code.

import type { MinorUnits } from './pack';
import { sumLedger, type LedgerRow } from './ledger';

export type CertaintyLevel = 'collected' | 'committed' | 'projected';

export interface CertaintyFigure {
	readonly level: CertaintyLevel;
	readonly from: string;
	readonly to: string;
	readonly amount: MinorUnits;
}

/** A day approved but not yet on an invoice line, already priced. `amount`
 * is `null` when no rate card could price it (`priceWorkUnitOnDate`'s own
 * contract) — an unpriced day contributes nothing, it is never guessed
 * at. Which `work_unit` rows qualify as "approved" is the caller's job
 * (`fiscal/forecast.ts` queries `state = 'approved'`): a proposed day
 * never reaches this type at all, which is what keeps it out of
 * `committedAmount` without this module needing to know about `state`. */
export interface ApprovedWorkUnit {
	readonly date: string;
	readonly amount: MinorUnits | null;
}

export interface RecurringFeeOccurrence {
	readonly date: string;
	readonly amount: MinorUnits;
}

/** A contract's own recurring-fee schedule, already expanded into
 * occurrences (`domain/recurring-fee.ts`) over whichever window the
 * caller asked for — this module only ever decides which of them fall
 * inside or outside the irrevocability window, never how often they
 * recur. */
export interface RecurringFeeContract {
	readonly terminationNoticeDays: number;
	readonly endsOn: string | null;
	readonly occurrences: readonly RecurringFeeOccurrence[];
}

function addDaysIso(date: string, days: number): string {
	const parsed = new Date(`${date}T00:00:00Z`);
	parsed.setUTCDate(parsed.getUTCDate() + days);
	return parsed.toISOString().slice(0, 10);
}

/**
 * The irrevocability window's inclusive end (#38, epic #5): serving
 * termination notice on `asOfDate` still runs the contract
 * `terminationNoticeDays` more days, so revenue through that date is
 * guaranteed regardless of what the counterparty decides today. Clipped
 * to the contract's own end when it has one — the window cannot promise a
 * day the contract itself does not reach. `null` once the contract has
 * already ended by `asOfDate`: nothing is guaranteed by a notice period on
 * a contract that is already over.
 */
export function irrevocabilityWindowEnd(
	contract: Pick<RecurringFeeContract, 'terminationNoticeDays' | 'endsOn'>,
	asOfDate: string
): string | null {
	if (contract.endsOn !== null && contract.endsOn < asOfDate) return null;
	const noticeEnd = addDaysIso(asOfDate, contract.terminationNoticeDays);
	return contract.endsOn !== null && contract.endsOn < noticeEnd ? contract.endsOn : noticeEnd;
}

/** Collected: payment date set, money in the bank. Always cash basis,
 * unconditionally — this is not a reading the active pack chooses, it is
 * what "collected" means. Reuses `sumLedger` rather than a parallel sum. */
export function collectedAmount(
	rows: readonly LedgerRow[],
	from: string,
	to: string
): CertaintyFigure {
	return { level: 'collected', from, to, amount: sumLedger(rows, 'cash', from, to).amount };
}

/**
 * Committed: issued unpaid invoices, approved not-yet-invoiced days, and
 * recurring fees inside the irrevocability window (#38, epic #5).
 *
 * The unpaid-invoice share reuses `sumLedger` too — `rows` filtered to
 * `paidOn === null` (an invoice that has not been collected has no cash
 * date to read), summed under `'accrual'` (issue date is the only date it
 * has). Not a new summation: the same function `collectedAmount` calls,
 * over a different slice of the same rows and a different basis.
 */
export function committedAmount(
	rows: readonly LedgerRow[],
	approvedWorkUnits: readonly ApprovedWorkUnit[],
	recurringContracts: readonly RecurringFeeContract[],
	asOfDate: string,
	from: string,
	to: string
): CertaintyFigure {
	const issuedUnpaid = sumLedger(
		rows.filter((row) => row.paidOn === null),
		'accrual',
		from,
		to
	).amount;

	const approvedNotInvoiced = approvedWorkUnits.reduce((sum, unit) => {
		if (unit.amount === null || unit.date < from || unit.date >= to) return sum;
		return sum + unit.amount;
	}, 0);

	const recurring = recurringContracts.reduce((sum, contract) => {
		const windowEnd = irrevocabilityWindowEnd(contract, asOfDate);
		if (windowEnd === null) return sum;
		const inWindow = contract.occurrences.filter(
			(o) => o.date >= asOfDate && o.date <= windowEnd && o.date >= from && o.date < to
		);
		return sum + inWindow.reduce((s, o) => s + o.amount, 0);
	}, 0);

	return { level: 'committed', from, to, amount: issuedUnpaid + approvedNotInvoiced + recurring };
}

/**
 * Projected: recurring fees beyond the irrevocability window, up to the
 * contract's own end date (#38, epic #5). Explicit renewal assumptions are
 * #39, next wave — not modelled here. A contract with no end date
 * projects nothing beyond its committed window: an indefinite contract's
 * future past the notice period is exactly the assumption #39 will add,
 * never one this engine invents on its own.
 */
export function projectedAmount(
	recurringContracts: readonly RecurringFeeContract[],
	asOfDate: string,
	from: string,
	to: string
): CertaintyFigure {
	const amount = recurringContracts.reduce((sum, contract) => {
		const endsOn = contract.endsOn;
		if (endsOn === null) return sum;
		const windowEnd = irrevocabilityWindowEnd(contract, asOfDate) ?? asOfDate;
		const beyondWindow = contract.occurrences.filter(
			(o) => o.date > windowEnd && o.date <= endsOn && o.date >= from && o.date < to
		);
		return sum + beyondWindow.reduce((s, o) => s + o.amount, 0);
	}, 0);
	return { level: 'projected', from, to, amount };
}

/** All three levels over the same `[from, to)`, for a caller that wants
 * the full breakdown in one call — #58's stacked bar reads this shape
 * directly, on top of the three individually-queryable functions above. */
export interface CertaintyBreakdown {
	readonly collected: CertaintyFigure;
	readonly committed: CertaintyFigure;
	readonly projected: CertaintyFigure;
}

export function certaintyBreakdown(
	rows: readonly LedgerRow[],
	approvedWorkUnits: readonly ApprovedWorkUnit[],
	recurringContracts: readonly RecurringFeeContract[],
	asOfDate: string,
	from: string,
	to: string
): CertaintyBreakdown {
	return {
		collected: collectedAmount(rows, from, to),
		committed: committedAmount(rows, approvedWorkUnits, recurringContracts, asOfDate, from, to),
		projected: projectedAmount(recurringContracts, asOfDate, from, to)
	};
}
