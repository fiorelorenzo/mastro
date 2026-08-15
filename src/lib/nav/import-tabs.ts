import { resolve } from '$app/paths';
import * as m from '$lib/paraglide/messages';

/**
 * The three importers' shared tab bar. The list lived inline on each of
 * the three pages, which is three chances for the order to drift apart -
 * and the order is the point here: contracts, then days, then invoices,
 * following the order the documents themselves arrive in. You sign a
 * contract before you work the days it covers, and you bill those days
 * after you have worked them.
 */
export type ImportTab = 'contracts' | 'days' | 'invoices';

export function importTabs(selected: ImportTab) {
	return [
		{
			href: resolve('/import/contracts'),
			label: m.import_tab_contracts(),
			selected: selected === 'contracts'
		},
		{ href: resolve('/import/days'), label: m.import_tab_days(), selected: selected === 'days' },
		{ href: resolve('/import'), label: m.import_tab_invoices(), selected: selected === 'invoices' }
	];
}
