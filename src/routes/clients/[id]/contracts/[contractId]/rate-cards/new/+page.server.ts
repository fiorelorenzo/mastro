import { error, fail, redirect } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages';
import { isPostgresConstraintViolation } from '$lib/server/db/postgres-error';
import { getContractWithClient } from '$lib/server/repositories/contract';
import { createRateCard } from '$lib/server/repositories/rate-card';
import { parseRateCardForm } from '$lib/server/repositories/rate-card-form';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const contract = await getContractWithClient(params.contractId);
	if (!contract || contract.clientId !== params.id) error(404, m.contract_not_found());
	return { contract };
};

export const actions: Actions = {
	default: async ({ request, params }) => {
		const formData = await request.formData();
		const result = parseRateCardForm(formData);
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });

		try {
			await createRateCard({ ...result.input, contractId: params.contractId });
		} catch (err) {
			if (isPostgresConstraintViolation(err, '23P01', 'rate_card_no_overlapping_validity')) {
				return fail(400, {
					errors: { validFrom: m.rate_card_validation_overlap() },
					values: result.values
				});
			}
			throw err;
		}

		redirect(303, `/clients/${params.id}/contracts/${params.contractId}`);
	}
};
