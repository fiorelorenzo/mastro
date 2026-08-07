import { error, fail, redirect } from '@sveltejs/kit';
import { mailContractCrumbs } from '$lib/nav/crumbs';
import * as m from '$lib/paraglide/messages';
import { getContract } from '$lib/server/repositories/contract';
import { createEmailTemplate } from '$lib/server/repositories/email-template';
import { parseEmailTemplateForm } from '$lib/server/repositories/email-template-form';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const contract = await getContract(params.id);
	if (!contract) error(404, m.mail_contract_not_found());

	const crumbs = mailContractCrumbs(contract);
	return { contract, crumbs };
};

export const actions: Actions = {
	default: async ({ request, params }) => {
		const formData = await request.formData();
		formData.set('contractId', params.id);
		const result = parseEmailTemplateForm(formData);
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });

		await createEmailTemplate(result.input);
		redirect(303, `/mail/contracts/${params.id}`);
	}
};
