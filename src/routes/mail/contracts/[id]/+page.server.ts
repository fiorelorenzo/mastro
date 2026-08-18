import { error } from '@sveltejs/kit';
import { mailCrumbs } from '$lib/nav/crumbs';
import * as m from '$lib/paraglide/messages';
import { isLocale } from '$lib/paraglide/runtime';
import { mailboxPollHealth } from '$lib/server/alerts/run-health';
import { db } from '$lib/server/db';
import { isPostgresConstraintViolation } from '$lib/server/db/postgres-error';
import {
	getContractWithClient,
	setContractAutoSendMail,
	setContractMailFolder,
	setContractTemplateLanguage
} from '$lib/server/repositories/contract';
import { listEmailTemplatesForContract } from '$lib/server/repositories/email-template';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const contract = await getContractWithClient(params.id);
	if (!contract) error(404, m.mail_contract_not_found());
	const [templates, mailPoll] = await Promise.all([
		listEmailTemplatesForContract(params.id),
		mailboxPollHealth(db)
	]);

	const crumbs = mailCrumbs();
	return { contract, templates, mailPoll, crumbs };
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
	},

	mailFolder: async ({ request, params }) => {
		const contract = await getContractWithClient(params.id);
		if (!contract) error(404, m.mail_contract_not_found());
		const formData = await request.formData();
		const mailFolder = String(formData.get('mailFolder') ?? '').trim() || null;
		try {
			await setContractMailFolder(params.id, mailFolder);
		} catch (err) {
			if (isPostgresConstraintViolation(err, '23505', 'contract_mail_folder_key')) {
				return { ok: false, mailFolderError: m.mail_contract_inbound_folder_duplicate() };
			}
			throw err;
		}
		return { ok: true };
	}
};
