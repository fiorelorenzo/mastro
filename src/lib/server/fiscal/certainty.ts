// Certainty levels (#38), as epic #5 defines them: collected, committed
// and projected, "used everywhere a future number appears". All three are
// pure functions over already-fetched data — `fiscal/forecast.ts` is
// where the database is actually read — so every figure here is
// hand-verifiable against a fixture built in code.

import {
	NO_MINOR_UNITS,
	addMinorUnits,
	scaleMinorUnits,
	sumMinorUnits,
	type MinorUnits
} from '$lib/money';
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

/**
 * An explicit belief about revenue beyond a contract's own known term
 * (#39) — the irrevocability window when the contract has no `endsOn`,
 * `endsOn` itself otherwise. `probability` and `expectedVolumeMinorUnits`
 * are the human's own estimate (AGENTS.md invariant 3, "agents propose,
 * humans confirm": this module never invents either);  `horizonEndsOn`
 * is the inclusive date the assumption stops projecting at, so it does
 * not forecast forever. See `renewalAssumptionContribution` below for
 * how the three combine into a figure.
 */
export interface RenewalAssumption {
	readonly probability: number;
	readonly expectedVolumeMinorUnits: MinorUnits;
	readonly horizonEndsOn: string;
}

/** A contract's own recurring-fee schedule, already expanded into
 * occurrences (`domain/recurring-fee.ts`) over whichever window the
 * caller asked for — this module only ever decides which of them fall
 * inside or outside the irrevocability window, never how often they
 * recur. `renewalAssumption` is #39's own addition: present only when a
 * human has recorded one
 * (`repositories/contract-renewal-assumption.ts`), absent or `null`
 * otherwise — never defaulted here. */
export interface RecurringFeeContract {
	readonly terminationNoticeDays: number;
	readonly endsOn: string | null;
	readonly occurrences: readonly RecurringFeeOccurrence[];
	readonly renewalAssumption?: RenewalAssumption | null;
}

function addDaysIso(date: string, days: number): string {
	const parsed = new Date(`${date}T00:00:00Z`);
	parsed.setUTCDate(parsed.getUTCDate() + days);
	return parsed.toISOString().slice(0, 10);
}

/** Whole days between two ISO dates, `to` exclusive — the day count
 * `renewalAssumptionContribution` prorates `expectedVolumeMinorUnits`
 * across, and the fraction of it any query window overlaps. */
function daysBetweenIso(from: string, toExclusive: string): number {
	const fromMs = Date.parse(`${from}T00:00:00Z`);
	const toMs = Date.parse(`${toExclusive}T00:00:00Z`);
	return Math.round((toMs - fromMs) / 86_400_000);
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
 * Committed: issued invoices' own *remaining* balance, approved
 * not-yet-invoiced days, and recurring fees inside the irrevocability
 * window (#38, epic #5).
 *
 * A partly paid invoice (#212) contributes only what is left, not its
 * full accrual amount — the collected share already counts under
 * `collectedAmount`, and double-counting it here would overstate what is
 * still outstanding. `row.amount - sum(row.payments)`, floored at zero,
 * summed by `issueDate` over `[from, to)`: not `sumLedger`, since that
 * function's accrual reading is deliberately "the whole invoice, once,
 * unconditionally" — exactly the figure a partly settled invoice must
 * not contribute here.
 */
export function committedAmount(
	rows: readonly LedgerRow[],
	approvedWorkUnits: readonly ApprovedWorkUnit[],
	recurringContracts: readonly RecurringFeeContract[],
	asOfDate: string,
	from: string,
	to: string
): CertaintyFigure {
	const issuedUnpaid = sumMinorUnits(
		rows
			.filter((row) => row.issueDate >= from && row.issueDate < to)
			.map((row) => {
				const collected = sumMinorUnits(row.payments.map((p) => p.amount));
				return Math.max(row.amount - collected, 0) as MinorUnits;
			})
	);

	const pricedApproved = approvedWorkUnits.filter(
		(unit): unit is ApprovedWorkUnit & { amount: MinorUnits } =>
			unit.amount !== null && unit.date >= from && unit.date < to
	);
	const approvedNotInvoiced = sumMinorUnits(pricedApproved.map((unit) => unit.amount));

	const recurring = sumMinorUnits(
		recurringContracts.flatMap((contract) => {
			const windowEnd = irrevocabilityWindowEnd(contract, asOfDate);
			if (windowEnd === null) return [];
			return contract.occurrences
				.filter((o) => o.date >= asOfDate && o.date <= windowEnd && o.date >= from && o.date < to)
				.map((o) => o.amount);
		})
	);

	return {
		level: 'committed',
		from,
		to,
		amount: addMinorUnits(issuedUnpaid, approvedNotInvoiced, recurring)
	};
}

/**
 * A contract's own projected renewal contribution over `[from, to)`
 * (#39): zero with no `renewalAssumption` recorded — the acceptance test
 * this module is built around, "empty rather than guessed" — otherwise
 * `probability * expectedVolumeMinorUnits`, spread evenly across the
 * assumption's own horizon (the day after the contract's known term
 * ends, through `horizonEndsOn` inclusive) and restricted to the overlap
 * with `[from, to)`. Exported on its own, not folded invisibly into
 * `projectedAmount`'s aggregate, so a screen can show one contract's own
 * assumption parameters next to the exact figure they produced —
 * `repositories/contract-renewal-assumption.ts`'s
 * `listRenewalAssumptionsWithContract` and `fiscal/forecast.ts`'s
 * `forecastRenewalAssumptions` pair the two through this same function.
 */
export function renewalAssumptionContribution(
	contract: RecurringFeeContract,
	asOfDate: string,
	from: string,
	to: string
): MinorUnits {
	const assumption = contract.renewalAssumption;
	if (!assumption) return NO_MINOR_UNITS;

	// The known term ends at the contract's own `endsOn` when it has one
	// (already covered by `projectedAmount`'s own scheduled occurrences)
	// or at the irrevocability window otherwise — the same cutoff
	// `committedAmount`/`projectedAmount` already use, never a second one
	// invented here.
	const windowEnd = irrevocabilityWindowEnd(contract, asOfDate);
	if (windowEnd === null) return NO_MINOR_UNITS; // the contract itself is already over

	const assumptionStart = addDaysIso(contract.endsOn ?? windowEnd, 1);
	const horizonEndExclusive = addDaysIso(assumption.horizonEndsOn, 1);
	if (assumptionStart >= horizonEndExclusive) return NO_MINOR_UNITS; // horizon already elapsed

	const overlapStart = assumptionStart > from ? assumptionStart : from;
	const overlapEndExclusive = horizonEndExclusive < to ? horizonEndExclusive : to;
	if (overlapStart >= overlapEndExclusive) return NO_MINOR_UNITS;

	const totalDays = daysBetweenIso(assumptionStart, horizonEndExclusive);
	const overlapDays = daysBetweenIso(overlapStart, overlapEndExclusive);
	// `probability` is `numeric(5,4)`
	// (`db/schema/contract-renewal-assumption.ts`), never more precise than
	// four decimal digits, so basis points round-trip it exactly. Folding
	// the day overlap into the numerator and `10_000 * totalDays` into the
	// denominator keeps the whole computation exact integers until
	// `scaleMinorUnits`'s own single rounding step (#323).
	const probabilityBasisPoints = Math.round(assumption.probability * 10_000);
	return scaleMinorUnits(
		assumption.expectedVolumeMinorUnits,
		probabilityBasisPoints * overlapDays,
		10_000 * totalDays
	);
}

/**
 * Projected: recurring fees beyond the irrevocability window up to the
 * contract's own end date, plus that contract's own renewal assumption
 * beyond its known term (#38/#39, epic #5). With no `renewalAssumption`
 * recorded, a contract's future past its known term stays empty — never
 * guessed at (see `renewalAssumptionContribution`'s own doc comment for
 * exactly where the two figures hand off).
 */
export function projectedAmount(
	recurringContracts: readonly RecurringFeeContract[],
	asOfDate: string,
	from: string,
	to: string
): CertaintyFigure {
	const amount = sumMinorUnits(
		recurringContracts.map((contract) => {
			const endsOn = contract.endsOn;
			let scheduled: MinorUnits = NO_MINOR_UNITS;
			if (endsOn !== null) {
				const windowEnd = irrevocabilityWindowEnd(contract, asOfDate) ?? asOfDate;
				const beyondWindow = contract.occurrences.filter(
					(o) => o.date > windowEnd && o.date <= endsOn && o.date >= from && o.date < to
				);
				scheduled = sumMinorUnits(beyondWindow.map((o) => o.amount));
			}
			return addMinorUnits(scheduled, renewalAssumptionContribution(contract, asOfDate, from, to));
		})
	);
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
