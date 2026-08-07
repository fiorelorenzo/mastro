import { error, redirect } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages';
import type { Crumb } from '$lib/nav/crumbs';
import { listClients } from '$lib/server/repositories/client';
import { listContracts } from '$lib/server/repositories/contract';
import { listWorkUnitsBetween } from '$lib/server/repositories/work-unit';
import type { PageServerLoad } from './$types';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The day carries one work_unit per contract, not one per date overall
 * (the schema's uniqueness is `(contract_id, date)`), so a date with two
 * active contracts worked the same day genuinely can carry more than one
 * row. This page exists only for that rare case: exactly one entry skips
 * straight to `/day/[id]` (#25's "tapping a day opens it" without an
 * unnecessary extra step for the common case), and none redirects to
 * starting a new one.
 */
export const load: PageServerLoad = async ({ params }) => {
	if (!ISO_DATE.test(params.date)) error(404);

	const entries = await listWorkUnitsBetween(params.date, params.date);

	if (entries.length === 0) redirect(307, `/day/new?date=${params.date}`);
	if (entries.length === 1) redirect(307, `/day/${entries[0].id}`);

	const [contracts, clients] = await Promise.all([listContracts(), listClients()]);
	const clientNameById = new Map(clients.map((client) => [client.id, client.legalName]));
	const contractById = new Map(contracts.map((contract) => [contract.id, contract]));

	return {
		date: params.date,
		entries: entries.map((entry) => {
			const contract = contractById.get(entry.contractId);
			return {
				id: entry.id,
				state: entry.state,
				contractLabel: contract
					? `${clientNameById.get(contract.clientId) ?? contract.clientId} — ${contract.title}`
					: entry.contractId
			};
		}),
		crumbs: [{ href: '/day/calendar', label: m.home_calendar_link() }] as Crumb[]
	};
};
