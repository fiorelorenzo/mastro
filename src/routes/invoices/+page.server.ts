import { addMinorUnits, NO_MINOR_UNITS, type MinorUnits } from '$lib/money';
import { daysLate, isOverdue } from '$lib/server/domain/invoice';
import {
	countInvoicesByTab,
	getInvoiceListTotals,
	listInvoices,
	type InvoiceListRow,
	type InvoiceListTab
} from '$lib/server/repositories/invoice';
import { AGEING_BAND_KEYS, ageingBandKey, ageingBandLabel, type AgeingBandKey } from './status';
import type { PageServerLoad } from './$types';

export type Row = InvoiceListRow & { daysLate: number; overdue: boolean };
export interface Band {
	key: AgeingBandKey;
	label: string;
	rows: readonly Row[];
	subtotalByCurrency: Record<string, MinorUnits>;
}
type Tab = InvoiceListTab;

const TAB_VALUES: readonly Tab[] = ['all', 'due', 'overdue', 'paid'];
const OVERDUE_BAND_KEYS: readonly AgeingBandKey[] = ['overdue_critical', 'overdue'];
// #311: the ageing list fetches one bounded page at a time instead of
// every invoice in the ledger — the same "most recent N" shape
// `routes/import/runs/+page.server.ts` already uses for its own long
// list.
const PAGE_SIZE = 50;

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
			// the current page's unpaid/overdue rows), so the subtotal is
			// what remains to be collected on this page, not what was
			// originally billed.
			subtotalByCurrency: sumByCurrency(bandRows, (row) => row.balance.remaining)
		};
	});
}

// The ageing list (#238): every invoice in the instance, not just the
// unpaid ones `listUnpaidInvoices` used to hard-code — a paid invoice used
// to be reachable only by typing its URL. `tab` picks which slice shows,
// pushed into the query itself (#311) rather than filtered from a full
// fetch; `page` (1-based) walks a bounded, `PAGE_SIZE`-row window of it.
// `daysLate`/`overdue` are recomputed against "now" for every row exactly
// as before, so ordering and every badge stay correct even if the
// process has been up for months with no job running. "Unpaid"/"paid"
// (#212) mean `!balance.settled`/`balance.settled` — a partly paid
// invoice stays on the unpaid side, for whatever it still owes. The tab
// badges and the stats strip are summed in SQL across the *whole*
// matching set (`countInvoicesByTab`/`getInvoiceListTotals`), never just
// the page on screen: a self-hoster reading "to collect" must see the
// real total regardless of which page they landed on.
export const load: PageServerLoad = async ({ url }) => {
	const now = new Date();

	const requestedTab = url.searchParams.get('tab');
	const tab: Tab = TAB_VALUES.includes(requestedTab as Tab) ? (requestedTab as Tab) : 'due';
	const requestedPage = Number(url.searchParams.get('page'));
	const wantedPage = Number.isInteger(requestedPage) && requestedPage > 1 ? requestedPage : 1;

	const [countsByTab, totals] = await Promise.all([
		countInvoicesByTab(now),
		getInvoiceListTotals(now)
	]);

	const totalCount = countsByTab[tab];
	const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
	// A stale `?page=` (bookmarked, or a row paid off the last page since)
	// clamps to the last real page rather than rendering an empty one.
	const page = Math.min(wantedPage, totalPages);
	const offset = (page - 1) * PAGE_SIZE;

	const pageRows = await listInvoices({ tab, limit: PAGE_SIZE, offset, today: now });
	const rows: Row[] = pageRows.map((row) => ({
		...row,
		daysLate: daysLate(row.invoice.dueDate, now),
		overdue: isOverdue(row.invoice.dueDate, row.balance.settledOn, now)
	}));

	const bandsByTab: Record<Tab, Band[] | null> = {
		all: null,
		due: bandsFor(rows, AGEING_BAND_KEYS),
		overdue: bandsFor(rows, OVERDUE_BAND_KEYS),
		paid: null
	};

	return {
		tab,
		rows,
		bands: bandsByTab[tab],
		unpaidCount: countsByTab.due,
		overdueCount: countsByTab.overdue,
		paidCount: countsByTab.paid,
		allCount: countsByTab.all,
		totalOutstandingByCurrency: totals.totalOutstandingByCurrency,
		totalOverdueByCurrency: totals.totalOverdueByCurrency,
		totalCollectedThisYearByCurrency: totals.totalCollectedThisYearByCurrency,
		paidThisYearCount: totals.paidThisYearCount,
		// The worst (largest) days-late figure among overdue invoices —
		// the entire overdue set, not just this page's slice of it.
		worstDaysLate: totals.oldestOverdueDueDate ? daysLate(totals.oldestOverdueDueDate, now) : 0,
		// Pagination (#311): `totalCount`/`totalPages` describe the active
		// tab's whole matching set, so the page can say "showing 1-50 of
		// 240" honestly instead of silently rendering only what fit.
		page,
		pageSize: PAGE_SIZE,
		totalCount,
		totalPages,
		rangeStart: totalCount === 0 ? 0 : offset + 1,
		rangeEnd: offset + rows.length
	};
};
