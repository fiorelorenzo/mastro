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

function sumByCurrency(rows: readonly Row[]): Record<string, MinorUnits> {
	return rows.reduce<Record<string, MinorUnits>>((totals, row) => {
		totals[row.invoice.currency] = addMinorUnits(
			totals[row.invoice.currency] ?? NO_MINOR_UNITS,
			row.invoice.total
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
			subtotalByCurrency: sumByCurrency(bandRows)
		};
	});
}

// The ageing list (#238): every invoice in the instance, not just the
// unpaid ones `listUnpaidInvoices` used to hard-code — a paid invoice used
// to be reachable only by typing its URL. `tab` picks which slice shows;
// `daysLate`/`overdue` are recomputed against "now" for every row exactly
// as the old loader did, so ordering and every badge stay correct even if
// the process has been up for months with no job running.
export const load: PageServerLoad = async ({ url }) => {
	const now = new Date();
	const allRows: Row[] = (await listInvoices()).map((row) => ({
		...row,
		daysLate: daysLate(row.invoice.dueDate, now),
		overdue: isOverdue(row.invoice.dueDate, row.invoice.paidOn, now)
	}));

	const unpaidRows = allRows
		.filter((row) => row.invoice.paidOn === null)
		.sort((a, b) => b.daysLate - a.daysLate);
	const overdueRows = unpaidRows.filter((row) => row.overdue);
	const paidRows = allRows
		.filter((row): row is Row & { invoice: { paidOn: string } } => row.invoice.paidOn !== null)
		.sort((a, b) => b.invoice.paidOn.localeCompare(a.invoice.paidOn));

	const currentYear = now.getUTCFullYear();
	const paidThisYearRows = paidRows.filter(
		(row) => new Date(`${row.invoice.paidOn}T00:00:00Z`).getUTCFullYear() === currentYear
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
		totalOutstandingByCurrency: sumByCurrency(unpaidRows),
		totalOverdueByCurrency: sumByCurrency(overdueRows),
		totalCollectedThisYearByCurrency: sumByCurrency(paidThisYearRows),
		paidThisYearCount: paidThisYearRows.length,
		// The worst (largest) days-late figure among overdue rows — `unpaidRows`
		// is already sorted most-overdue-first, so this is just its head.
		worstDaysLate: overdueRows[0]?.daysLate ?? 0
	};
};
