import { expect, test } from 'vitest';
import { BOTTOM_BAR_HREFS, NAV_GROUPS, isNavItemActive } from './items';

test('the three groups carry the agreed items, in order', () => {
	expect(NAV_GROUPS.map((g) => g.items.map((i) => i.href))).toEqual([
		['/', '/day/calendar'],
		['/clients', '/invoices'],
		['/import', '/mail', '/alerts', '/settings']
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

test('the bottom bar carries the four a phone actually opens', () => {
	expect(BOTTOM_BAR_HREFS).toEqual(['/', '/day/calendar', '/clients', '/invoices']);
});
