import { addMinorUnits, NO_MINOR_UNITS, type MinorUnits } from '$lib/money';
import { daysLate, isOverdue } from '$lib/server/domain/invoice';
import { listInvoices, type InvoiceListRow } from '$lib/server/repositories/invoice';
import { AGEING_BAND_KEYS, ageingBandKey, ageingBandLabel, type AgeingBandKey } from './status';
import type { PageServerLoad } from './$types';

export type Row = InvoiceListRow & { daysLate: number; overdue: boolean };
export interface Band {
	key: AgeingBandKey;
	label: string;
	rows: readonly Row[];
	subtotalByCurrency: Record<string, MinorUnits>;
}
type Tab = 'all' | 'due' | 'overdue' | 'paid';

const TAB_VALUES: readonly Tab[] = ['all', 'due', 'overdue', 'paid'];
const OVERDUE_BAND_KEYS: readonly AgeingBandKey[] = ['overdue_critical', 'overdue'];

/** `amountOf` reads whichever figure the caller's context means by "the
 *  amount" — remaining balance for an unpaid band, actual cash received
 *  for a collected one (#212: never one flat `invoice.total` for both). */
function sumByCurrency(
	rows: readonly Row[],
	amountOf: (row: Row) => MinorUnits
): Record<string, MinorUnits> {
	return rows.reduce<Record<string, MinorUnits>>((totals, row) => {
		totals[row.invoice.currency] = addMinorUnits(
			totals[row.invoice.currency] ?? NO_MINOR_UNITS,
			amountOf(row)
		);
		return totals;
	}, {});
}

function bandsFor(rows: readonly Row[], keys: readonly AgeingBandKey[]): Band[] {
	return keys.map((key) => {
		const bandRows = rows.filter((row) => ageingBandKey(row.daysLate) === key);
		return {
			key,
			label: ageingBandLabel(key),
			rows: bandRows,
			// Every row here is unpaid (`bandsFor` is only ever called with
			// `unpaidRows`/`overdueRows`), so the subtotal is what remains
			// to be collected, not what was originally billed.
			subtotalByCurrency: sumByCurrency(bandRows, (row) => row.balance.remaining)
		};
	});
}

// The ageing list (#238): every invoice in the instance, not just the
// unpaid ones `listUnpaidInvoices` used to hard-code — a paid invoice used
// to be reachable only by typing its URL. `tab` picks which slice shows;
// `daysLate`/`overdue` are recomputed against "now" for every row exactly
// as the old loader did, so ordering and every badge stay correct even if
// the process has been up for months with no job running. "Unpaid"/"paid"
// (#212) mean `!balance.settled`/`balance.settled` — a partly paid
// invoice stays on the unpaid side, for whatever it still owes.
export const load: PageServerLoad = async ({ url }) => {
	const now = new Date();
	const allRows: Row[] = (await listInvoices()).map((row) => ({
		...row,
		daysLate: daysLate(row.invoice.dueDate, now),
		overdue: isOverdue(row.invoice.dueDate, row.balance.settledOn, now)
	}));

	const unpaidRows = allRows
		.filter((row) => !row.balance.settled)
		.sort((a, b) => b.daysLate - a.daysLate);
	const overdueRows = unpaidRows.filter((row) => row.overdue);
	const paidRows = allRows
		.filter((row): row is Row & { balance: { settledOn: string } } => row.balance.settled)
		.sort((a, b) => (b.balance.settledOn ?? '').localeCompare(a.balance.settledOn ?? ''));

	// "Collected this year" (#212) is the money that actually arrived
	// within the current calendar year, not the total of whichever
	// invoices happened to become fully settled inside it: a payment
	// received this year against an invoice settled next year (or not
	// yet settled at all) still counts, and one received last year
	// against an invoice that only settles this year does not.
	const currentYear = now.getUTCFullYear();
	const paymentsThisYear = allRows.flatMap((row) =>
		row.payments
			.filter((p) => new Date(`${p.date}T00:00:00Z`).getUTCFullYear() === currentYear)
			.map((p) => ({ amount: p.amount, currency: row.invoice.currency }))
	);
	const invoicesPaidThisYear = new Set(
		allRows
			.filter((row) =>
				row.payments.some((p) => new Date(`${p.date}T00:00:00Z`).getUTCFullYear() === currentYear)
			)
			.map((row) => row.invoice.id)
	);

	const requested = url.searchParams.get('tab');
	const tab: Tab = TAB_VALUES.includes(requested as Tab) ? (requested as Tab) : 'due';

	const rowsByTab: Record<Tab, readonly Row[]> = {
		all: allRows,
		due: unpaidRows,
		overdue: overdueRows,
		paid: paidRows
	};
	const bandsByTab: Record<Tab, Band[] | null> = {
		all: null,
		due: bandsFor(unpaidRows, AGEING_BAND_KEYS),
		overdue: bandsFor(overdueRows, OVERDUE_BAND_KEYS),
		paid: null
	};

	return {
		tab,
		rows: rowsByTab[tab],
		bands: bandsByTab[tab],
		unpaidCount: unpaidRows.length,
		overdueCount: overdueRows.length,
		paidCount: paidRows.length,
		allCount: allRows.length,
		totalOutstandingByCurrency: sumByCurrency(unpaidRows, (row) => row.balance.remaining),
		totalOverdueByCurrency: sumByCurrency(overdueRows, (row) => row.balance.remaining),
		totalCollectedThisYearByCurrency: paymentsThisYear.reduce<Record<string, MinorUnits>>(
			(totals, p) => {
				totals[p.currency] = addMinorUnits(totals[p.currency] ?? NO_MINOR_UNITS, p.amount);
				return totals;
			},
			{}
		),
		paidThisYearCount: invoicesPaidThisYear.size,
		// The worst (largest) days-late figure among overdue rows — `unpaidRows`
		// is already sorted most-overdue-first, so this is just its head.
		worstDaysLate: overdueRows[0]?.daysLate ?? 0
	};
};
