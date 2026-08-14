// #223, #39: the renewal assumption, set from the contract's own renewal
// block — one row per contract, created the first time and edited in
// place after (`repositories/contract-renewal-assumption.ts`'s own
// comment on why: the row IS the current belief, not a version history).
import { error, fail, redirect } from '@sveltejs/kit';
import { contractCrumbs } from '$lib/nav/crumbs';
import * as m from '$lib/paraglide/messages';
import { getContractWithClient } from '$lib/server/repositories/contract';
import {
	createRenewalAssumption,
	deleteRenewalAssumption,
	getRenewalAssumptionByContract,
	updateRenewalAssumption
} from '$lib/server/repositories/contract-renewal-assumption';
import { parseRenewalAssumptionForm } from '$lib/server/repositories/contract-renewal-assumption-form';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const contract = await getContractWithClient(params.contractId);
	if (!contract || contract.clientId !== params.id) error(404, m.contract_not_found());

	const assumption = await getRenewalAssumptionByContract(params.contractId);
	const crumbs = contractCrumbs(contract);
	return { contract, assumption, crumbs };
};

export const actions: Actions = {
	default: async ({ request, params }) => {
		const contract = await getContractWithClient(params.contractId);
		if (!contract || contract.clientId !== params.id) error(404, m.contract_not_found());

		const formData = await request.formData();
		const result = parseRenewalAssumptionForm(formData, contract.currency, params.contractId);
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });

		const existing = await getRenewalAssumptionByContract(params.contractId);
		if (existing) {
			await updateRenewalAssumption(existing.id, result.input);
		} else {
			await createRenewalAssumption(result.input);
		}

		redirect(303, `/clients/${params.id}/contracts/${params.contractId}`);
	},
	delete: async ({ params }) => {
		const contract = await getContractWithClient(params.contractId);
		if (!contract || contract.clientId !== params.id) error(404, m.contract_not_found());

		const existing = await getRenewalAssumptionByContract(params.contractId);
		if (existing) await deleteRenewalAssumption(existing.id);

		redirect(303, `/clients/${params.id}/contracts/${params.contractId}`);
	}
};
