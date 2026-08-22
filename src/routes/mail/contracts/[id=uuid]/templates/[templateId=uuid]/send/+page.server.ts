import { error, fail } from '@sveltejs/kit';
import { mailContractCrumbs } from '$lib/nav/crumbs';
import * as m from '$lib/paraglide/messages';
import { getClientWithContacts } from '$lib/server/repositories/client';
import { getEmailTemplate } from '$lib/server/repositories/email-template';
import {
	parseMailSendForm,
	type MailSendFormValues
} from '$lib/server/repositories/mail-send-form';
import { getInvoiceWithLines, listInvoicesForContract } from '$lib/server/repositories/invoice';
import { buildManualSendContext } from '$lib/server/mail/compose';
import { mailConfigFromEnv } from '$lib/server/mail/config';
import { dispatchEmail, prepareEmail, type PreparedSend } from '$lib/server/mail/send';
import type { Actions, PageServerLoad } from './$types';

async function loadTemplate(templateId: string, contractId: string) {
	const template = await getEmailTemplate(templateId);
	if (!template || template.contractId !== contractId) error(404, m.mail_template_not_found());
	return template;
}

export const load: PageServerLoad = async ({ params }) => {
	const template = await loadTemplate(params.templateId, params.id);

	const [client, invoices] = await Promise.all([
		getClientWithContacts(template.contract.clientId),
		listInvoicesForContract(params.id)
	]);
	const defaultRecipients = client?.contacts.map((contact) => contact.email).join(', ') ?? '';

	const crumbs = mailContractCrumbs({ id: params.id, title: template.contract.title });
	return { template, invoices, defaultRecipients, crumbs };
};

type ActionOutcome =
	| { ok: true; values: MailSendFormValues; prepared: PreparedSend }
	| { ok: false; errors: Record<string, string>; values: MailSendFormValues };

async function runForm(
	request: Request,
	templateId: string,
	contractId: string
): Promise<ActionOutcome> {
	const template = await loadTemplate(templateId, contractId);
	const invoices = await listInvoicesForContract(contractId);

	const formData = await request.formData();
	const result = parseMailSendForm(formData, invoices);
	if (!result.ok) return { ok: false, errors: result.errors, values: result.values };

	// `result.invoiceId` was just validated against `invoices` — this
	// contract's own — so the row it names always exists.
	const invoiceRow = await getInvoiceWithLines(result.invoiceId);
	if (!invoiceRow) error(404, m.invoice_not_found());

	const context = await buildManualSendContext(invoiceRow, template.contract.templateLanguage);
	const prepared = await prepareEmail(template, context, result.to, invoiceRow.id);
	return { ok: true, values: result.values, prepared };
}

export const actions: Actions = {
	preview: async ({ request, params }) => {
		const result = await runForm(request, params.templateId, params.id);
		if (!result.ok)
			return fail(400, { errors: result.errors, values: result.values, preview: null });

		return {
			errors: {},
			values: result.values,
			preview: {
				to: result.prepared.to,
				subject: result.prepared.subject,
				body: result.prepared.body,
				attachments: result.prepared.attachments.map((a) => ({
					filename: a.filename,
					size: a.content.length
				}))
			}
		};
	},

	send: async ({ request, params }) => {
		const result = await runForm(request, params.templateId, params.id);
		if (!result.ok)
			return fail(400, { errors: result.errors, values: result.values, preview: null });

		const mailConfig = mailConfigFromEnv();
		await dispatchEmail(result.prepared, mailConfig, false);

		return {
			errors: {},
			values: result.values,
			preview: null,
			sent: true
		};
	}
};
