// The dunning compose screen (#73): draft, preview and send a payment
// reminder for one overdue invoice. Same preview-then-send split as the
// general compose screen (#72) — `preview` never sends, `send` is the one
// explicit action that does, and there is no automatic path at all here
// for dunning (see `src/lib/server/mail/dunning.ts`).
//
// #230: before a `send`, this also asks `sent_email` whether the chosen
// template already went out for this invoice within the current chase
// period (`findChaseThisPeriod`) — the chasing flow's own memory of
// itself. A duplicate never blocks outright: the human sees the warning
// on the preview and must tick `confirmDuplicate` before `send` accepts
// it, so a genuinely-intended second reminder (an escalation, a client
// who lost the first email) still goes out, just never by accident.
import { error, fail } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages';
import { invoiceCrumbs } from '$lib/nav/crumbs';
import { daysLate, isOverdue } from '$lib/server/domain/invoice';
import { getClientWithContacts } from '$lib/server/repositories/client';
import {
	parseDunningSendForm,
	type DunningSendFormValues,
	type DunningTemplateOption
} from '$lib/server/repositories/dunning-form';
import { listEmailTemplatesForContract } from '$lib/server/repositories/email-template';
import { getInvoiceWithLines } from '$lib/server/repositories/invoice';
import { chasePeriodStart, findChaseThisPeriod } from '$lib/server/repositories/sent-email';
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
	const crumbs = invoiceCrumbs(invoiceRow);
	return {
		invoice: invoiceRow,
		templates,
		defaultRecipients,
		daysLate: daysLate(invoiceRow.dueDate),
		crumbs
	};
};

/** A prior chase this same template already made against this invoice,
 * inside the current period — `null` once `confirmDuplicate` clears it, so
 * `send` never re-blocks a submission the human already confirmed. */
type DuplicateChase = { templateName: string; sentAt: string } | null;

type ActionOutcome =
	| {
			ok: true;
			values: DunningSendFormValues;
			prepared: PreparedSend;
			duplicate: DuplicateChase;
			confirmDuplicate: boolean;
	  }
	| { ok: false; errors: Record<string, string>; values: DunningSendFormValues };

async function runForm(request: Request, invoiceId: string): Promise<ActionOutcome> {
	const { invoiceRow, templates } = await loadOverdueInvoice(invoiceId);
	const formData = await request.formData();
	const confirmDuplicate = formData.get('confirmDuplicate') === 'true';
	const result = parseDunningSendForm(formData, templates);
	if (!result.ok) return { ok: false, errors: result.errors, values: result.values };

	const context = await buildDunningContext(invoiceRow, invoiceRow.contract.templateLanguage);
	const prepared = await prepareEmail(result.template, context, result.to, invoiceRow.id);

	const existingChase = await findChaseThisPeriod(
		invoiceRow.id,
		result.template.id,
		chasePeriodStart(new Date())
	);
	const duplicate: DuplicateChase = existingChase
		? { templateName: result.template.name, sentAt: existingChase.sentAt.toISOString() }
		: null;

	return { ok: true, values: result.values, prepared, duplicate, confirmDuplicate };
}

export const actions: Actions = {
	preview: async ({ request, params }) => {
		const result = await runForm(request, params.id);
		if (!result.ok) {
			return fail(400, {
				errors: result.errors,
				values: result.values,
				preview: null,
				duplicate: null
			});
		}
		return {
			errors: {},
			values: result.values,
			preview: {
				to: result.prepared.to,
				subject: result.prepared.subject,
				body: result.prepared.body
			},
			duplicate: result.duplicate
		};
	},

	send: async ({ request, params }) => {
		const result = await runForm(request, params.id);
		if (!result.ok) {
			return fail(400, {
				errors: result.errors,
				values: result.values,
				preview: null,
				duplicate: null
			});
		}
		if (result.duplicate && !result.confirmDuplicate) {
			return fail(409, {
				errors: { confirmDuplicate: m.mail_dunning_duplicate_confirm_required() },
				values: result.values,
				preview: {
					to: result.prepared.to,
					subject: result.prepared.subject,
					body: result.prepared.body
				},
				duplicate: result.duplicate
			});
		}

		const mailConfig = mailConfigFromEnv();
		await dispatchEmail(result.prepared, mailConfig, false);
		return { errors: {}, values: result.values, preview: null, sent: true, duplicate: null };
	}
};
