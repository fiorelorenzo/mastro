import { fail, redirect } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages';
import { isPostgresConstraintViolation } from '$lib/server/db/postgres-error';
import { createClient } from '$lib/server/repositories/client';
import { parseClientForm } from '$lib/server/repositories/client-form';
import type { Actions } from './$types';

export const actions: Actions = {
	default: async ({ request }) => {
		const formData = await request.formData();
		const result = parseClientForm(formData);
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });

		try {
			await createClient(result.input);
		} catch (error) {
			if (isPostgresConstraintViolation(error, '23505', 'client_tax_id_unique')) {
				return fail(400, {
					errors: { taxId: m.client_validation_tax_id_duplicate() },
					values: result.values
				});
			}
			throw error;
		}

		redirect(303, '/clients');
	}
};
