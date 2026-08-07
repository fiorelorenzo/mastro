import { error, fail, redirect } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages';
import { isOverdue } from '$lib/server/domain/invoice';
import { getInvoiceWithLines, recordPayment } from '$lib/server/repositories/invoice';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const invoiceRow = await getInvoiceWithLines(params.id);
	if (!invoiceRow) error(404, m.invoice_not_found());
	return {
		invoice: invoiceRow,
		// Today, at UTC midnight as an ISO date — what the "paid on" field
		// defaults to (#27's "defaults to today"), computed once here so the
		// form and any later reasoning about it agree on the same instant.
		today: new Date().toISOString().slice(0, 10),
		// Whether the "draft a reminder" link (#73) shows at all — the same
		// derivation the ageing table uses, recomputed here rather than
		// read off a stored flag.
		overdue: isOverdue(invoiceRow.dueDate, invoiceRow.paidOn)
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
