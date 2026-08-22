import { error, fail, redirect } from '@sveltejs/kit';
import { contractCrumbs } from '$lib/nav/crumbs';
import * as m from '$lib/paraglide/messages';
import { isPostgresConstraintViolation } from '$lib/server/db/postgres-error';
import { getContractWithClient } from '$lib/server/repositories/contract';
import { createCeiling } from '$lib/server/repositories/ceiling';
import { parseCeilingForm } from '$lib/server/repositories/ceiling-form';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const contract = await getContractWithClient(params.contractId);
	if (!contract || contract.clientId !== params.id) error(404, m.contract_not_found());

	const crumbs = contractCrumbs(contract);
	return { contract, crumbs };
};

export const actions: Actions = {
	default: async ({ request, params }) => {
		const contract = await getContractWithClient(params.contractId);
		if (!contract || contract.clientId !== params.id) error(404, m.contract_not_found());

		const formData = await request.formData();
		const result = parseCeilingForm(formData, contract.currency, params.contractId);
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });

		try {
			await createCeiling(result.input);
		} catch (err) {
			if (isPostgresConstraintViolation(err, '23505', 'ceiling_contract_code_unique')) {
				return fail(400, {
					errors: { code: m.ceiling_validation_duplicate_code() },
					values: result.values
				});
			}
			throw err;
		}

		redirect(303, `/clients/${params.id}/contracts/${params.contractId}`);
	}
};
