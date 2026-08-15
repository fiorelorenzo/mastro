import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import type { PageServerLoad } from './$types';

/**
 * `/import` is the section, not one of the three importers in it. It used
 * to *be* the invoice importer, which meant the sidebar's own "Import"
 * link landed on whichever tab happened to sit at that path - the last
 * one, once the bar was ordered contracts, days, invoices. Each importer
 * owns a path now (`invoices`, `days`, `contracts`) and this sends you to
 * the first tab, so there is one canonical way in.
 *
 * 303 rather than a permanent redirect: which tab opens first is a
 * product decision that may change, and a 301 would be cached by every
 * browser that ever followed it.
 */
export const load: PageServerLoad = () => {
	redirect(303, resolve('/import/contracts'));
};
