import { error, fail, redirect } from '@sveltejs/kit';
import { isPostgresConstraintViolation } from '$lib/server/db/postgres-error';
import { getClientWithContacts, updateClient } from '$lib/server/repositories/client';
import { parseClientForm } from '$lib/server/repositories/client-form';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const client = await getClientWithContacts(params.id);
	if (!client) error(404, 'Client not found');
	return { client };
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
					errors: { taxId: 'A client with this tax id already exists.' },
					values: result.values
				});
			}
			throw err;
		}

		redirect(303, '/clients');
	}
};
