import { error, fail, redirect } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages';
import { getContractWithClient, updateContract } from '$lib/server/repositories/contract';
import { parseContractForm } from '$lib/server/repositories/contract-form';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const contract = await getContractWithClient(params.contractId);
	if (!contract || contract.clientId !== params.id) error(404, m.contract_not_found());
	return { contract };
};

export const actions: Actions = {
	default: async ({ request, params }) => {
		const formData = await request.formData();
		const result = parseContractForm(formData);
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });

		await updateContract(params.contractId, { ...result.input, clientId: params.id });
		redirect(303, `/clients/${params.id}/contracts/${params.contractId}`);
	}
};
