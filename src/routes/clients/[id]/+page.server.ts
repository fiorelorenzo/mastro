import { error } from '@sveltejs/kit';
import { clientsCrumbs } from '$lib/nav/crumbs';
import * as m from '$lib/paraglide/messages';
import { getClientWithContacts } from '$lib/server/repositories/client';
import { listContracts } from '$lib/server/repositories/contract';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const client = await getClientWithContacts(params.id);
	if (!client) error(404, m.client_not_found());

	const contracts = await listContracts(params.id);

	const crumbs = clientsCrumbs();
	return { client, contracts, crumbs };
};
