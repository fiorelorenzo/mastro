import { error, fail, redirect } from '@sveltejs/kit';
import type { Crumb } from '$lib/nav/crumbs';
import * as m from '$lib/paraglide/messages';
import { isPostgresConstraintViolation } from '$lib/server/db/postgres-error';
import { getClientWithContacts, updateClient } from '$lib/server/repositories/client';
import { parseClientForm } from '$lib/server/repositories/client-form';
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
		const result = parseClientForm(formData);
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });

		try {
			await updateClient(params.id, result.input);
		} catch (err) {
			if (isPostgresConstraintViolation(err, '23505', 'client_tax_id_unique')) {
				return fail(400, {
					errors: { taxId: m.client_validation_tax_id_duplicate() },
					values: result.values
				});
			}
			throw err;
		}

		redirect(303, '/clients');
	}
};
