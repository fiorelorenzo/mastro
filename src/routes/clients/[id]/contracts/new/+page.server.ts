import { error, fail, redirect } from '@sveltejs/kit';
import type { Crumb } from '$lib/nav/crumbs';
import * as m from '$lib/paraglide/messages';
import { getClientWithContacts } from '$lib/server/repositories/client';
import { createContract } from '$lib/server/repositories/contract';
import { parseContractForm } from '$lib/server/repositories/contract-form';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const client = await getClientWithContacts(params.id);
	if (!client) error(404, m.client_not_found());

	const crumbs: Crumb[] = [
		{ href: '/clients', label: m.clients_heading() },
		{ href: `/clients/${client.id}`, label: client.legalName }
	];
	return { client, crumbs };
};

export const actions: Actions = {
	default: async ({ request, params }) => {
		const formData = await request.formData();
		const result = parseContractForm(formData);
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });

		const contractRow = await createContract({ ...result.input, clientId: params.id });
		redirect(303, `/clients/${params.id}/contracts/${contractRow.id}`);
	}
};
