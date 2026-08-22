import { resolve } from '$app/paths';
import * as m from '$lib/paraglide/messages';

/**
 * One step of a breadcrumb trail: where it goes, and what it is called.
 *
 * A trail carries the page's **ancestors only**, never the page itself: the
 * page is the title right below the trail, and repeating it there says
 * nothing. That is also what makes the phone collapse exact rather than a
 * guess, since the last crumb is by definition the parent.
 *
 * The label is a string, not a message function, because only a `load` knows
 * which client a contract belongs to. Trails are built server-side, where the
 * locale of the request is already resolved.
 */
export interface Crumb {
	readonly href: string;
	readonly label: string;
}

/**
 * The subtitle line: the few facts that matter about this record, joined.
 *
 * Callers assemble it from optional pieces (a date that may be open-ended, a
 * notice period a contract may not have), so anything missing is dropped
 * rather than rendered as an empty gap between two separators.
 */
export function factLine(parts: readonly (string | null | undefined)[]): string {
	return parts
		.map((part) => part?.trim())
		.filter((part): part is string => Boolean(part))
		.join(' · ');
}

/**
 * Assembles a trail and refuses a duplicate `href`.
 *
 * `PageHeader` renders the trail as a keyed `{#each}` keyed on the href, so
 * two crumbs pointing at the same URL are not a cosmetic repetition: Svelte
 * throws on the duplicate key during hydration, and the page goes blank a
 * moment after the server's correct HTML has already painted, with nothing
 * in the console. That has happened twice (#143, then the mail template
 * routes, where a crumb named the page itself and a `?template=` suffix was
 * added to make the key unique rather than to point anywhere).
 *
 * A duplicate is always a defect in the caller: a trail is a chain of
 * ancestors, and two ancestors cannot be the same page. Failing here turns a
 * blank screen into a stack trace pointing at the loader that built it.
 */
function trail(...crumbs: Crumb[]): Crumb[] {
	const seen = new Set<string>();
	for (const crumb of crumbs) {
		if (seen.has(crumb.href)) {
			throw new Error(`duplicate breadcrumb href: ${crumb.href}`);
		}
		seen.add(crumb.href);
	}
	return crumbs;
}

// Every builder below is a function rather than a constant, and that is not
// stylistic: the labels come from message functions, which resolve against
// the locale of the current request. A module-level constant would freeze
// whichever locale happened to be active when the module was first imported
// and serve it to everyone after that.

/** The clients list, the root of the client family. */
export function clientsCrumbs(): Crumb[] {
	return trail({ href: resolve('/clients'), label: m.clients_heading() });
}

/** Clients, then one client: the trail for anything under `/clients/[id]`. */
export function clientCrumbs(client: { id: string; legalName: string }): Crumb[] {
	return trail(...clientsCrumbs(), {
		href: resolve('/clients/[id=uuid]', { id: client.id }),
		label: client.legalName
	});
}

/**
 * Clients, the client, then the contract: the trail for anything under a
 * contract. The contract page itself passes `clientCrumbs` instead, since a
 * trail never carries the page it sits on.
 */
export function contractCrumbs(contract: {
	id: string;
	clientId: string;
	title: string;
	client: { legalName: string };
}): Crumb[] {
	return trail(...clientCrumbs({ id: contract.clientId, legalName: contract.client.legalName }), {
		href: resolve('/clients/[id=uuid]/contracts/[contractId=uuid]', {
			id: contract.clientId,
			contractId: contract.id
		}),
		label: contract.title
	});
}

/** The communications index, the root of the mail family. */
export function mailCrumbs(): Crumb[] {
	return trail({ href: resolve('/mail'), label: m.nav_communications() });
}

/**
 * Communications, then one contract's mailbox. The template edit and send
 * pages stop here: a template has no page of its own to link to, and its
 * name is already the heading those pages render.
 */
export function mailContractCrumbs(contract: { id: string; title: string }): Crumb[] {
	return trail(...mailCrumbs(), {
		href: resolve('/mail/contracts/[id=uuid]', { id: contract.id }),
		label: contract.title
	});
}

/** The unpaid invoices list, the root of the invoice family. */
export function invoicesCrumbs(): Crumb[] {
	return trail({ href: resolve('/invoices'), label: m.invoices_heading() });
}

/** Invoices, then one invoice. */
export function invoiceCrumbs(invoice: { id: string; number: string }): Crumb[] {
	return trail(...invoicesCrumbs(), {
		href: resolve('/invoices/[id=uuid]', { id: invoice.id }),
		label: invoice.number
	});
}

/** The month grid, the parent every single-day route hangs off. */
export function calendarCrumbs(): Crumb[] {
	return trail({ href: resolve('/day/calendar'), label: m.nav_calendar() });
}

/** The alerts list, parent of the alert settings page. */
export function alertsCrumbs(): Crumb[] {
	return trail({ href: resolve('/alerts'), label: m.nav_alerts() });
}

/** The proposals list, parent of a single proposal. */
export function proposalsCrumbs(): Crumb[] {
	return trail({ href: resolve('/proposals'), label: m.proposal_list_heading() });
}

/** The settings page, parent of the fiscal profile sub-page. */
export function settingsCrumbs(): Crumb[] {
	return trail({ href: resolve('/settings'), label: m.settings_heading() });
}
