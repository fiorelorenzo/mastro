// The central calculation (#37): one ledger, either reading. Every invoice
// carries both an accrual date (`issueDate`, always present) and a cash
// date (`paidOn`, present only once collected) over the same `amount` —
// cash and accrual are not two ledgers, they are two dates read off one
// row. `sumLedger` is the only place that distinction is made; a caller
// asking "what if I collect this in January" builds one hypothetical
// `LedgerRow` (or edits `paidOn` on an existing one) and calls it again —
// never a second function, per this issue's own acceptance bullet.
//
// Periods here are half-open `[from, to)`, matching `resolve.ts` and
// `profile.ts` — the two files this module composes with to answer "which
// basis, over which sub-period" across a regime change.

import type { MinorUnits } from './pack';

export type LedgerBasis = 'cash' | 'accrual';

/**
 * One invoice, reduced to what the ledger needs: the two dates that could
 * matter and the one amount that counts towards revenue. `amount` is
 * opaque here — `fiscal/revenue.ts` decides what belongs in it (taxable
 * amount plus any statutory surcharge that counts as revenue without
 * being taxable income, see `it-flat-rate.ts`'s header comment) — this
 * module only ever sums it. `paidOn` is `null` until the invoice is
 * actually collected, which is exactly what makes it disappear from a
 * cash-basis sum until then.
 */
export interface LedgerRow {
	readonly invoiceId: string;
	readonly contractId: string;
	readonly clientId: string;
	readonly issueDate: string;
	readonly paidOn: string | null;
	readonly amount: MinorUnits;
}

/**
 * A revenue figure that always says how it was produced (#37's "every
 * figure the UI shows carries which basis produced it") — never a bare
 * number a caller could accidentally render without knowing what it
 * means.
 */
export interface LedgerFigure {
	readonly basis: LedgerBasis;
	readonly from: string;
	readonly to: string;
	readonly amount: MinorUnits;
}

/**
 * `rows` summed under `basis` over `[from, to)`. The one function both
 * readings go through: `basis` is a parameter, not a fork, so a caller
 * that wants "what would this look like on the other basis" changes an
 * argument, not a call site. A row whose relevant date falls outside the
 * period, or that has none yet (an unpaid invoice under `'cash'`),
 * contributes nothing.
 */
export function sumLedger(
	rows: readonly LedgerRow[],
	basis: LedgerBasis,
	from: string,
	to: string
): LedgerFigure {
	if (from >= to) throw new Error(`invalid period: from (${from}) must be before to (${to})`);
	const amount = rows.reduce((sum, row) => {
		// The date that matters for `basis` — `paidOn` (`null` until the
		// invoice is actually collected) for `'cash'`, `issueDate` for
		// `'accrual'`.
		const date = basis === 'cash' ? row.paidOn : row.issueDate;
		if (date === null || date < from || date >= to) return sum;
		return sum + row.amount;
	}, 0);
	return { basis, from, to, amount };
}

/** One sub-period of a range, already resolved to the pack that actually
 * applied to it — the shape `resolvePackOverRange`'s result maps onto
 * directly (see `fiscal/revenue.ts`). */
export interface LedgerPeriod {
	readonly basis: LedgerBasis;
	readonly from: string;
	readonly to: string;
	readonly packId: string;
}

export interface LedgerRegimeFigure {
	readonly amount: MinorUnits;
	/** One figure per sub-period, each still carrying its own basis — a
	 * range spanning a regime change never collapses into a single
	 * basis label that would misrepresent part of the total. */
	readonly subFigures: readonly (LedgerFigure & { readonly packId: string })[];
}

/**
 * Revenue over a range that may span a regime change (#37): each of
 * `periods` is summed under its own basis, and the total is their sum.
 * Reuses `sumLedger` once per sub-period — never a parallel
 * "multi-period" summation loop with its own basis logic.
 */
export function sumLedgerAcrossPeriods(
	rows: readonly LedgerRow[],
	periods: readonly LedgerPeriod[]
): LedgerRegimeFigure {
	const subFigures = periods.map((period) => ({
		...sumLedger(rows, period.basis, period.from, period.to),
		packId: period.packId
	}));
	return { amount: subFigures.reduce((sum, figure) => sum + figure.amount, 0), subFigures };
}
