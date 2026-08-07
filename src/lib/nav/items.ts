// The navigation model (#146). Data, not markup: the sidebar and the bottom
// bar both render this, so they cannot disagree about what exists or what
// is active, and the rule for "which section am I in" is testable without a
// browser.
import * as m from '$lib/paraglide/messages';

export interface NavItem {
	readonly href: string;
	readonly label: () => string;
	/** Renders the unread alert count next to the item. */
	readonly badge?: 'alerts';
}

export interface NavGroup {
	readonly items: readonly NavItem[];
}

/** Daily, then the objects, then what is opened rarely. */
export const NAV_GROUPS: readonly NavGroup[] = [
	{
		items: [
			{ href: '/', label: m.nav_today },
			{ href: '/day/calendar', label: m.nav_calendar }
		]
	},
	{
		items: [
			{ href: '/clients', label: m.nav_clients },
			{ href: '/invoices', label: m.nav_invoices }
		]
	},
	{
		items: [
			{ href: '/import', label: m.nav_import },
			{ href: '/mail', label: m.nav_communications },
			{ href: '/alerts', label: m.nav_alerts, badge: 'alerts' },
			{ href: '/settings', label: m.nav_settings }
		]
	}
];

/**
 * What the bottom bar shows below 900px. Four, and these four: they are the
 * only ones opened with a phone in hand, and v0's promise is a day recorded
 * in under thirty seconds one-handed. Everything else lives behind "More".
 */
export const BOTTOM_BAR_HREFS: readonly string[] = ['/', '/day/calendar', '/clients', '/invoices'];

/**
 * Whether `itemHref`'s section contains `pathname`.
 *
 * Prefix matching with a boundary, not `startsWith`: `/day/calendar` must not
 * match `/day/calendar-export`. The dashboard is exact-only, since `/` is a
 * prefix of everything.
 */
export function isNavItemActive(itemHref: string, pathname: string): boolean {
	if (itemHref === '/') return pathname === '/';
	return pathname === itemHref || pathname.startsWith(`${itemHref}/`);
}
