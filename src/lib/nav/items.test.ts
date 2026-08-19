import { expect, test } from 'vitest';
import { BOTTOM_BAR_HREFS, NAV_GROUPS, isNavItemActive } from './items';

test('the four groups carry the daily-loop-first IA, in order', () => {
	expect(NAV_GROUPS.map((g) => g.items.map((i) => i.href))).toEqual([
		['/', '/proposals', '/day/calendar'],
		['/clients', '/contracts', '/invoices'],
		['/mail', '/import'],
		['/settings']
	]);
});

test('proposals is a first-class item, not reachable only from a dashboard card', () => {
	// #233's BLOCKER: "agents propose, humans confirm" had no persistent
	// nav entry for the human half of that invariant.
	const hrefs = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href));
	expect(hrefs).toContain('/proposals');
});

test('only the ledger and inbox groups carry a heading', () => {
	expect(NAV_GROUPS.map((g) => g.title?.())).toEqual([undefined, 'Ledger', 'Inbox', undefined]);
});

test('every item carries exactly one icon glyph', () => {
	for (const item of NAV_GROUPS.flatMap((g) => g.items)) {
		expect(item.icon.length, `${item.href} has no icon`).toBeGreaterThan(0);
	}
});

test('only the two counted destinations carry a badge, and each names a real queue', () => {
	const badged = NAV_GROUPS.flatMap((g) => g.items).filter((item) => item.badge);
	expect(badged.map((item) => [item.href, item.badge])).toEqual([
		['/proposals', 'proposals'],
		['/invoices', 'overdueInvoices']
	]);
});

test('a section stays active for everything underneath it', () => {
	// The whole point of the model: a rate card five levels down still
	// lights up Clients, so the sidebar always says which section you are in.
	expect(isNavItemActive('/clients', '/clients/abc/contracts/def/rate-cards/new')).toBe(true);
	expect(isNavItemActive('/invoices', '/invoices/abc/remind')).toBe(true);
	expect(isNavItemActive('/clients', '/invoices')).toBe(false);
});

test('the dashboard is active only on itself', () => {
	// Otherwise "/" prefixes every path in the app and every item lights up.
	expect(isNavItemActive('/', '/')).toBe(true);
	expect(isNavItemActive('/', '/clients')).toBe(false);
});

test('a section is not matched by a route that merely starts with its name', () => {
	expect(isNavItemActive('/day/calendar', '/day/calendar-export')).toBe(false);
});

test('the bottom bar carries the daily loop plus two ledger destinations, five in all', () => {
	expect(BOTTOM_BAR_HREFS).toEqual(['/', '/proposals', '/day/calendar', '/clients', '/invoices']);
});

test('every bottom bar href is a real nav item, and the rest are reachable behind More', () => {
	// `BottomBar.svelte` resolves each href with a non-null assertion and
	// derives "More" from whatever is left, so an href that matches no item
	// crashes the bar and an item in neither place is unreachable on a phone.
	const all = NAV_GROUPS.flatMap((group) => group.items).map((item) => item.href);

	for (const href of BOTTOM_BAR_HREFS) expect(all).toContain(href);
	expect(all.filter((href) => !BOTTOM_BAR_HREFS.includes(href))).toEqual([
		'/contracts',
		'/mail',
		'/import',
		'/settings'
	]);
});
