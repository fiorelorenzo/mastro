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

import type { MinorUnits } from '$lib/money';
import type { UnresolvedRevenueTreatment } from './pack';

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
	/** #122: what the pack in force for this period says happens to its
	 * own revenue that has not yet resolved when a later period takes
	 * over. See `UnresolvedRevenueTreatment` on `pack.ts`. */
	readonly unresolvedRevenue: UnresolvedRevenueTreatment;
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
 *
 * **One invoice is revenue once.** Sub-periods are walked oldest first
 * and each row is claimed by the first period whose own basis resolves
 * it, so a row an earlier period already recognised is invisible to
 * every later one. Without that (#129), an invoice issued under an
 * accrual period and paid under a later cash one was counted twice: once
 * by `issueDate` there, once by `paidOn` here, inflating the total and
 * able to make a ceiling look crossed when it is not. Accrual resolves
 * revenue at issuance, unconditionally, so the earlier period is the one
 * that keeps it.
 *
 * The mirror direction leaves the opposite gap (#122): an invoice issued
 * under a cash-basis period, still unpaid when that period's own window
 * ends, is invisible to `sumLedger` there (no `paidOn` yet) and
 * invisible to whatever comes after (its `issueDate` is not in that
 * later window either), so its revenue would be silently absent — not
 * double-counted, just missing. The second pass below closes exactly
 * that gap and nothing else: for each row no period claimed, if the pack
 * that governed at issuance is `'cash'` and declares
 * `unresolvedRevenue: 'carries_forward'`, and the row has since been
 * paid, it is attributed — still read by `paidOn`, under the issuing
 * pack's own basis, never the destination period's — to whichever
 * period's window actually contains that payment date.
 */
export function sumLedgerAcrossPeriods(
	rows: readonly LedgerRow[],
	periods: readonly LedgerPeriod[]
): LedgerRegimeFigure {
	// Oldest first, so "the first period that resolves a row keeps it"
	// means the earlier regime, whatever order the caller passed.
	const ordered = [...periods].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
	const claimed = new Set<string>();
	const subFigures: (LedgerFigure & { packId: string })[] = ordered.map((period) => {
		const resolvedHere = rows.filter((row) => {
			if (claimed.has(row.invoiceId)) return false;
			const date = period.basis === 'cash' ? row.paidOn : row.issueDate;
			return date !== null && date >= period.from && date < period.to;
		});
		for (const row of resolvedHere) claimed.add(row.invoiceId);
		return {
			...sumLedger(resolvedHere, period.basis, period.from, period.to),
			packId: period.packId
		};
	});

	// #122: `origin.packId` + `destination.from` groups every straddling
	// row landing in the same place into one figure, the same shape as
	// the sub-periods above — one entry per regime carry-forward, never
	// one per invoice.
	const carriedForward = new Map<string, LedgerFigure & { packId: string }>();
	for (const row of rows) {
		if (claimed.has(row.invoiceId)) continue;

		const origin = periods.find(
			(period) => row.issueDate >= period.from && row.issueDate < period.to
		);
		if (
			origin === undefined ||
			origin.basis !== 'cash' ||
			origin.unresolvedRevenue !== 'carries_forward' ||
			row.paidOn === null
		) {
			continue; // still unpaid, or this pack does not carry it forward: correctly missing for now.
		}
		const paidOn = row.paidOn;
		const destination = periods.find((period) => paidOn >= period.from && paidOn < period.to);
		if (destination === undefined) continue; // paid outside the queried range — the next query's concern.

		const key = `${origin.packId}:${destination.from}`;
		const existing = carriedForward.get(key);
		carriedForward.set(key, {
			basis: 'cash',
			from: destination.from,
			to: destination.to,
			packId: origin.packId,
			amount: (existing?.amount ?? 0) + row.amount
		});
	}

	const allFigures = [...subFigures, ...carriedForward.values()];
	return {
		amount: allFigures.reduce((sum, figure) => sum + figure.amount, 0),
		subFigures: allFigures
	};
}
