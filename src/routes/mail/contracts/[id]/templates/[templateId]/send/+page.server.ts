import { error, fail } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages';
import { getClientWithContacts } from '$lib/server/repositories/client';
import { getEmailTemplate } from '$lib/server/repositories/email-template';
import {
	parseMailSendForm,
	type MailSendFormValues
} from '$lib/server/repositories/mail-send-form';
import { buildRegister } from '$lib/server/repositories/register';
import { mailConfigFromEnv } from '$lib/server/mail/config';
import { dispatchEmail, prepareEmail } from '$lib/server/mail/send';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const template = await getEmailTemplate(params.templateId);
	if (!template || template.contractId !== params.id) error(404, m.mail_template_not_found());

	const client = await getClientWithContacts(template.contract.clientId);
	const defaultRecipients = client?.contacts.map((contact) => contact.email).join(', ') ?? '';

	return { template, defaultRecipients };
};

type PreviewValues = MailSendFormValues;

export const actions: Actions = {
	preview: async ({ request, params }) => {
		const template = await getEmailTemplate(params.templateId);
		if (!template || template.contractId !== params.id) error(404, m.mail_template_not_found());

		const formData = await request.formData();
		const result = parseMailSendForm(formData, template.contract.currency);
		if (!result.ok)
			return fail(400, { errors: result.errors, values: result.values, preview: null });

		const register = await buildRegister(params.id, result.period.from, result.period.to);
		const prepared = await prepareEmail(
			template,
			{
				invoice: result.invoice,
				period: result.period,
				register,
				language: template.contract.templateLanguage
			},
			result.to
		);

		return {
			errors: {},
			values: result.values,
			preview: {
				to: prepared.to,
				subject: prepared.subject,
				body: prepared.body,
				attachments: prepared.attachments.map((a) => ({
					filename: a.filename,
					size: a.content.length
				}))
			}
		};
	},

	send: async ({ request, params }) => {
		const template = await getEmailTemplate(params.templateId);
		if (!template || template.contractId !== params.id) error(404, m.mail_template_not_found());

		const formData = await request.formData();
		const result = parseMailSendForm(formData, template.contract.currency);
		if (!result.ok)
			return fail(400, { errors: result.errors, values: result.values, preview: null });

		const register = await buildRegister(params.id, result.period.from, result.period.to);
		const prepared = await prepareEmail(
			template,
			{
				invoice: result.invoice,
				period: result.period,
				register,
				language: template.contract.templateLanguage
			},
			result.to
		);

		const mailConfig = mailConfigFromEnv();
		await dispatchEmail(prepared, mailConfig, false);

		return {
			errors: {},
			values: result.values satisfies PreviewValues,
			preview: null,
			sent: true
		};
	}
};
