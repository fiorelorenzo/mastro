// The central calculation (#37): one ledger, either reading. Every invoice
// carries an accrual date (`issueDate`, always present) and, once money has
// actually arrived, one cash event per payment received (#212 — never a
// single "paid" date and a single lump amount, since a partial payment is
// itself a real cash event on its own date, not a fact that waits for the
// invoice to be settled before it counts). `sumLedger` is the only place
// the accrual/cash distinction is made; a caller asking "what if I collect
// this in January" builds one hypothetical `LedgerRow` (or edits its
// `payments`) and calls it again — never a second function, per this
// issue's own acceptance bullet.
//
// Periods here are half-open `[from, to)`, matching `resolve.ts` and
// `profile.ts` — the two files this module composes with to answer "which
// basis, over which sub-period" across a regime change.

import { NO_MINOR_UNITS, addMinorUnits, sumMinorUnits, type MinorUnits } from '$lib/money';
import type { UnresolvedRevenueTreatment } from './pack';

export type LedgerBasis = 'cash' | 'accrual';

/** One payment's own revenue contribution — its cash date, and the share
 *  of `LedgerRow.amount` it represents (see `fiscal/revenue.ts`'s
 *  `fetchLedgerRows` for how a gross payment becomes this). */
export interface LedgerPayment {
	readonly date: string;
	readonly amount: MinorUnits;
}

/**
 * One invoice, reduced to what the ledger needs: the accrual date and
 * amount that always apply, plus every payment actually received against
 * it so far (#212). `amount` is opaque here — `fiscal/revenue.ts` decides
 * what belongs in it (taxable amount plus any statutory surcharge that
 * counts as revenue without being taxable income, see `it-flat-rate.ts`'s
 * header comment) — this module only ever sums it. `payments` is empty
 * until the first one lands, which is exactly what makes an unpaid
 * invoice disappear from a cash-basis sum: cash basis recognises each
 * payment on its own date, for its own share of `amount`, never the
 * invoice's full amount the instant any money arrives.
 */
export interface LedgerRow {
	readonly invoiceId: string;
	readonly contractId: string;
	readonly clientId: string;
	readonly issueDate: string;
	readonly amount: MinorUnits;
	readonly payments: readonly LedgerPayment[];
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
 * argument, not a call site. Accrual sums each row's full `amount` once,
 * by `issueDate`; cash sums every individual payment whose own date falls
 * in the window (#212) — an invoice half paid inside the window and half
 * outside contributes only the half that landed here.
 */
export function sumLedger(
	rows: readonly LedgerRow[],
	basis: LedgerBasis,
	from: string,
	to: string
): LedgerFigure {
	if (from >= to) throw new Error(`invalid period: from (${from}) must be before to (${to})`);
	const amount =
		basis === 'accrual'
			? sumMinorUnits(
					rows.filter((row) => row.issueDate >= from && row.issueDate < to).map((row) => row.amount)
				)
			: sumMinorUnits(
					rows
						.flatMap((row) => row.payments)
						.filter((payment) => payment.date >= from && payment.date < to)
						.map((payment) => payment.amount)
				);
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
 * Reuses `sumLedger` once per sub-period for the accrual side — never a
 * parallel "multi-period" summation loop with its own basis logic.
 *
 * **One invoice is revenue once, and one payment is cash once (#212).**
 * `claimedAccrual` tracks whole invoices: the instant an accrual period
 * recognises a row by its `issueDate`, none of that row's payments are
 * ever separately recognised anywhere else — accrual resolves revenue at
 * issuance, unconditionally, so a later cash-basis sighting of the same
 * money would double it (#129). `attributed` tracks individual payments:
 * a cash period recognises exactly the payments whose own date falls in
 * its window, and once one has been counted there it is never counted
 * again by the carry-forward pass below, even if that payment's date
 * would also satisfy a later period's window (periods here are disjoint,
 * so in practice this only guards the invariant rather than changing any
 * real total).
 *
 * The carry-forward pass closes the mirror gap (#122): a payment whose
 * own date falls inside a period of a *different* basis than the one
 * that would naturally read it — typically because the invoice was
 * issued under an earlier cash-basis pack that has since given way to an
 * accrual one — is invisible to the per-period pass above (an accrual
 * period only ever looks at `issueDate`, never a payment date). If the
 * pack that governed at issuance is cash-basis and declares
 * `unresolvedRevenue: 'carries_forward'`, each such payment is still
 * attributed — under the *origin* pack's own basis, never the
 * destination period's — to whichever period's window actually contains
 * it.
 */
export function sumLedgerAcrossPeriods(
	rows: readonly LedgerRow[],
	periods: readonly LedgerPeriod[]
): LedgerRegimeFigure {
	// Oldest first, so "the first period that resolves a row keeps it"
	// means the earlier regime, whatever order the caller passed.
	const ordered = [...periods].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
	const claimedAccrual = new Set<string>();
	const attributed = new Set<string>();

	const subFigures: (LedgerFigure & { packId: string })[] = ordered.map((period) => {
		if (period.basis === 'accrual') {
			const resolvedHere = rows.filter(
				(row) =>
					!claimedAccrual.has(row.invoiceId) &&
					row.issueDate >= period.from &&
					row.issueDate < period.to
			);
			for (const row of resolvedHere) claimedAccrual.add(row.invoiceId);
			return {
				...sumLedger(resolvedHere, 'accrual', period.from, period.to),
				packId: period.packId
			};
		}

		let amount = NO_MINOR_UNITS;
		for (const row of rows) {
			if (claimedAccrual.has(row.invoiceId)) continue;
			row.payments.forEach((payment, index) => {
				const key = `${row.invoiceId}#${index}`;
				if (attributed.has(key) || payment.date < period.from || payment.date >= period.to) return;
				attributed.add(key);
				amount = addMinorUnits(amount, payment.amount);
			});
		}
		return { basis: 'cash', from: period.from, to: period.to, amount, packId: period.packId };
	});

	// #122: `origin.packId` + `destination.from` groups every straddling
	// payment landing in the same place into one figure, the same shape
	// as the sub-periods above — one entry per regime carry-forward,
	// never one per payment.
	const carriedForward = new Map<string, LedgerFigure & { packId: string }>();
	for (const row of rows) {
		if (claimedAccrual.has(row.invoiceId)) continue;

		const origin = periods.find(
			(period) => row.issueDate >= period.from && row.issueDate < period.to
		);
		if (
			origin === undefined ||
			origin.basis !== 'cash' ||
			origin.unresolvedRevenue !== 'carries_forward'
		) {
			continue; // still unpaid at issuance, or this pack does not carry it forward: correctly missing for now.
		}

		row.payments.forEach((payment, index) => {
			const key = `${row.invoiceId}#${index}`;
			if (attributed.has(key)) return;
			const destination = periods.find(
				(period) => payment.date >= period.from && payment.date < period.to
			);
			if (destination === undefined) return; // paid outside the queried range — the next query's concern.
			attributed.add(key);

			const figureKey = `${origin.packId}:${destination.from}`;
			const existing = carriedForward.get(figureKey);
			carriedForward.set(figureKey, {
				basis: 'cash',
				from: destination.from,
				to: destination.to,
				packId: origin.packId,
				amount: addMinorUnits(existing?.amount ?? NO_MINOR_UNITS, payment.amount)
			});
		});
	}

	const allFigures = [...subFigures, ...carriedForward.values()];
	return {
		amount: sumMinorUnits(allFigures.map((figure) => figure.amount)),
		subFigures: allFigures
	};
}
