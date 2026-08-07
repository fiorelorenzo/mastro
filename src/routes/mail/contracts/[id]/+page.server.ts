import { error } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages';
import { isLocale } from '$lib/paraglide/runtime';
import {
	getContractWithClient,
	setContractAutoSendMail,
	setContractTemplateLanguage
} from '$lib/server/repositories/contract';
import { listEmailTemplatesForContract } from '$lib/server/repositories/email-template';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const contract = await getContractWithClient(params.id);
	if (!contract) error(404, m.mail_contract_not_found());
	const templates = await listEmailTemplatesForContract(params.id);
	return { contract, templates };
};

export const actions: Actions = {
	autoSend: async ({ request, params }) => {
		const contract = await getContractWithClient(params.id);
		if (!contract) error(404, m.mail_contract_not_found());
		const formData = await request.formData();
		const autoSendMail = formData.get('autoSendMail') === 'on';
		await setContractAutoSendMail(params.id, autoSendMail);
		return { ok: true };
	},

	templateLanguage: async ({ request, params }) => {
		const contract = await getContractWithClient(params.id);
		if (!contract) error(404, m.mail_contract_not_found());
		const formData = await request.formData();
		const templateLanguage = String(formData.get('templateLanguage') ?? '');
		if (!isLocale(templateLanguage)) {
			return { ok: false, templateLanguageError: m.mail_contract_template_language_invalid() };
		}
		await setContractTemplateLanguage(params.id, templateLanguage);
		return { ok: true };
	}
};
