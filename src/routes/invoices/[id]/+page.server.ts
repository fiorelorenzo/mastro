import { error, fail, redirect } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages';
import { invoicesCrumbs } from '$lib/nav/crumbs';
import { daysLate, isOverdue } from '$lib/server/domain/invoice';
import { toSourceDocumentValue } from '$lib/server/repositories/document';
import {
	getInvoiceDocuments,
	getInvoiceWithLines,
	recordPayment
} from '$lib/server/repositories/invoice';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const invoiceRow = await getInvoiceWithLines(params.id);
	if (!invoiceRow) error(404, m.invoice_not_found());
	const documents = await getInvoiceDocuments(invoiceRow.id);
	const crumbs = invoicesCrumbs();
	return {
		invoice: invoiceRow,
		// The archived original(s): an import stores the structured
		// document plus any attachment alongside it (`persist.ts`), a
		// hand-entered invoice none — #215's "the archived original of an
		// imported invoice".
		documents: documents.map(toSourceDocumentValue),
		// Today, at UTC midnight as an ISO date — what the "paid on" field
		// defaults to (#27's "defaults to today"), computed once here so the
		// form and any later reasoning about it agree on the same instant.
		today: new Date().toISOString().slice(0, 10),
		// Whether the "draft a reminder" link (#73) shows at all — the same
		// derivation the ageing table uses, recomputed here rather than
		// read off a stored flag.
		overdue: isOverdue(invoiceRow.dueDate, invoiceRow.paidOn),
		// Feeds the page header's status word (the list's own
		// `ageingStatus`, computed the same way): only read when the
		// invoice is unpaid, but always recomputed against "now" rather
		// than trusting a stored flag, same reasoning as `overdue` above.
		daysLate: daysLate(invoiceRow.dueDate),
		crumbs
	};
};

export const actions: Actions = {
	// The second of #27's two interactions (the first is opening the
	// <details> disclosure in the template) — one field, one button.
	pay: async ({ request, params }) => {
		const formData = await request.formData();
		const paidOn = String(formData.get('paidOn') ?? '').trim();
		if (!paidOn) return fail(400, { payError: m.invoice_validation_paid_on_required() });

		await recordPayment(params.id, paidOn);
		redirect(303, `/invoices/${params.id}`);
	}
};
