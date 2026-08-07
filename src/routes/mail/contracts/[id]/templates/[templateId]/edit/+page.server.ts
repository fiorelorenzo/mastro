import { error, fail, redirect } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages';
import { getEmailTemplate, updateEmailTemplate } from '$lib/server/repositories/email-template';
import { parseEmailTemplateForm } from '$lib/server/repositories/email-template-form';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const template = await getEmailTemplate(params.templateId);
	if (!template || template.contractId !== params.id) error(404, m.mail_template_not_found());
	return { template };
};

export const actions: Actions = {
	default: async ({ request, params }) => {
		const formData = await request.formData();
		formData.set('contractId', params.id);
		const result = parseEmailTemplateForm(formData);
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });

		await updateEmailTemplate(params.templateId, result.input);
		redirect(303, `/mail/contracts/${params.id}`);
	}
};
