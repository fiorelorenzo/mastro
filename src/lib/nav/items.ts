// The navigation model (#146, #233). Data, not markup: the sidebar and the
// bottom bar both render this, so they cannot disagree about what exists or
// what is active, and the rule for "which section am I in" is testable
// without a browser.
import * as m from '$lib/paraglide/messages';

export interface NavItem {
	readonly href: string;
	readonly label: () => string;
	/** A single glyph, decorative (`aria-hidden`) — the label is what a
	 *  screen reader announces, the icon is a scan aid on top of it. */
	readonly icon: string;
	/** Renders a count pill next to the item when the count is above zero.
	 *  Each key names a real queue, not a generic "alerts" bucket: a nav
	 *  count that cannot be explained in one noun does not belong here. */
	readonly badge?: 'proposals' | 'overdueInvoices';
}

export interface NavGroup {
	/** Unlabelled for the daily loop (three items read as one cluster
	 *  without a caption) and for the trailing Settings row; every group in
	 *  between gets a small-caps heading so the clustering the mockup draws
	 *  is legible, not merely inferable from a gap. */
	readonly title?: () => string;
	readonly items: readonly NavItem[];
}

/**
 * The daily loop first, then the ledger, then the inbox, then what is
 * opened rarely — the IA `docs/specs/ux-review/mockups/_shell.html` draws.
 *
 * `/proposals` ("Da rivedere") is a first-class item on purpose: it is the
 * human half of "agents propose, humans confirm," and before this it had no
 * navigation entry at all, reachable only from a conditional dashboard card
 * (ux-review finding 1, the BLOCKER). `/alerts` drops out of the primary
 * nav in this pass — it stays reachable from Settings, whose own
 * `settings_alerts_link` already points at `/alerts/settings`, and from
 * there `alertsCrumbs()`'s trail — without a second "things needing
 * attention" destination competing with "Da rivedere" for the same job.
 */
export const NAV_GROUPS: readonly NavGroup[] = [
	{
		items: [
			{ href: '/', label: m.nav_today, icon: '◎' },
			{ href: '/proposals', label: m.nav_review, icon: '▤', badge: 'proposals' },
			{ href: '/day/calendar', label: m.nav_calendar, icon: '▦' }
		]
	},
	{
		title: m.nav_group_ledger,
		items: [
			{ href: '/clients', label: m.nav_clients, icon: '◫' },
			{ href: '/invoices', label: m.nav_invoices, icon: '€', badge: 'overdueInvoices' }
		]
	},
	{
		title: m.nav_group_inbox,
		items: [
			{ href: '/mail', label: m.nav_mail, icon: '✉' },
			{ href: '/import', label: m.nav_import, icon: '↥' }
		]
	},
	{
		items: [{ href: '/settings', label: m.nav_settings, icon: '⚙' }]
	}
];

/**
 * What the bottom bar shows below 900px: the daily loop plus the ledger,
 * five destinations mirroring the sidebar's first two groups exactly.
 * Everything else — Inbox and Settings — lives behind "More".
 */
export const BOTTOM_BAR_HREFS: readonly string[] = [
	'/',
	'/proposals',
	'/day/calendar',
	'/clients',
	'/invoices'
];

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
