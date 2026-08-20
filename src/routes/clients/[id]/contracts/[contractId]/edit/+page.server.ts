import { error, fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { resolveActiveFiscalPack } from '$lib/server/fiscal/profile';
import { socialChargeLabel } from '$lib/server/fiscal/pack';
import { getLocale } from '$lib/paraglide/runtime';
import { contractCrumbs } from '$lib/nav/crumbs';
import * as m from '$lib/paraglide/messages';
import { getContractWithClient, updateContract } from '$lib/server/repositories/contract';
import { parseContractForm } from '$lib/server/repositories/contract-form';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const contract = await getContractWithClient(params.contractId);
	if (!contract || contract.clientId !== params.id) error(404, m.contract_not_found());

	const crumbs = contractCrumbs(contract);

	// #379: the pack's own name for its social charge, or null when it
	// declares none - see the new-contract loader for why it comes from the
	// pack and not from the message catalogue.
	const activePack = await resolveActiveFiscalPack(db, new Date().toISOString().slice(0, 10));
	return {
		contract,
		crumbs,
		socialChargeLabel: socialChargeLabel(activePack?.pack ?? null, getLocale())
	};
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
