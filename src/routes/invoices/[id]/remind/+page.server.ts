// The dunning compose screen (#73): draft, preview and send a payment
// reminder for one overdue invoice. Same preview-then-send split as the
// general compose screen (#72) — `preview` never sends, `send` is the one
// explicit action that does, and there is no automatic path at all here
// for dunning (see `src/lib/server/mail/dunning.ts`).
import { error, fail } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages';
import { daysLate, isOverdue } from '$lib/server/domain/invoice';
import { getClientWithContacts } from '$lib/server/repositories/client';
import {
	parseDunningSendForm,
	type DunningSendFormValues,
	type DunningTemplateOption
} from '$lib/server/repositories/dunning-form';
import { listEmailTemplatesForContract } from '$lib/server/repositories/email-template';
import { getInvoiceWithLines } from '$lib/server/repositories/invoice';
import { mailConfigFromEnv } from '$lib/server/mail/config';
import { buildDunningContext } from '$lib/server/mail/dunning';
import { dispatchEmail, prepareEmail, type PreparedSend } from '$lib/server/mail/send';
import type { Actions, PageServerLoad } from './$types';

async function loadOverdueInvoice(id: string) {
	const invoiceRow = await getInvoiceWithLines(id);
	if (!invoiceRow) error(404, m.invoice_not_found());
	if (!isOverdue(invoiceRow.dueDate, invoiceRow.paidOn)) {
		error(400, m.mail_dunning_not_overdue());
	}
	const templates: DunningTemplateOption[] = (
		await listEmailTemplatesForContract(invoiceRow.contractId)
	).filter((template) => template.trigger.kind === 'days_after_due');
	return { invoiceRow, templates };
}

export const load: PageServerLoad = async ({ params }) => {
	const { invoiceRow, templates } = await loadOverdueInvoice(params.id);
	const client = await getClientWithContacts(invoiceRow.contract.clientId);
	const defaultRecipients = client?.contacts.map((contact) => contact.email).join(', ') ?? '';
	return {
		invoice: invoiceRow,
		templates,
		defaultRecipients,
		daysLate: daysLate(invoiceRow.dueDate)
	};
};

type ActionOutcome =
	| { ok: true; values: DunningSendFormValues; prepared: PreparedSend }
	| { ok: false; errors: Record<string, string>; values: DunningSendFormValues };

async function runForm(request: Request, invoiceId: string): Promise<ActionOutcome> {
	const { invoiceRow, templates } = await loadOverdueInvoice(invoiceId);
	const formData = await request.formData();
	const result = parseDunningSendForm(formData, templates);
	if (!result.ok) return { ok: false, errors: result.errors, values: result.values };

	const context = await buildDunningContext(invoiceRow, invoiceRow.contract.templateLanguage);
	const prepared = await prepareEmail(result.template, context, result.to);
	return { ok: true, values: result.values, prepared };
}

export const actions: Actions = {
	preview: async ({ request, params }) => {
		const result = await runForm(request, params.id);
		if (!result.ok) {
			return fail(400, { errors: result.errors, values: result.values, preview: null });
		}
		return {
			errors: {},
			values: result.values,
			preview: {
				to: result.prepared.to,
				subject: result.prepared.subject,
				body: result.prepared.body
			}
		};
	},

	send: async ({ request, params }) => {
		const result = await runForm(request, params.id);
		if (!result.ok) {
			return fail(400, { errors: result.errors, values: result.values, preview: null });
		}
		const mailConfig = mailConfigFromEnv();
		await dispatchEmail(result.prepared, mailConfig, false);
		return { errors: {}, values: result.values, preview: null, sent: true };
	}
};
