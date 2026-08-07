import { fail, redirect } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages';
import type { Crumb } from '$lib/nav/crumbs';
import { isPostgresConstraintViolation } from '$lib/server/db/postgres-error';
import { listContractsWithClient } from '$lib/server/repositories/contract';
import { createInvoice } from '$lib/server/repositories/invoice';
import { parseInvoiceForm } from '$lib/server/repositories/invoice-form';
import { listEligibleWorkUnitsForInvoicing } from '$lib/server/repositories/work-unit';
import type { Actions, PageServerLoad } from './$types';

// Contract selection happens in a GET step (`?contractId=`) before the
// creation form is usable: which days are eligible to bill (#26) depends
// on the contract, so there is nothing meaningful to offer as a day picker
// until one is chosen.
export const load: PageServerLoad = async ({ url }) => {
	const contracts = await listContractsWithClient();
	const contractId = url.searchParams.get('contractId') ?? '';
	const eligibleDays = contractId ? await listEligibleWorkUnitsForInvoicing(contractId) : [];
	const crumbs: Crumb[] = [{ href: '/invoices', label: m.invoices_heading() }];
	return { contracts, selectedContractId: contractId, eligibleDays, crumbs };
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const formData = await request.formData();
		const result = parseInvoiceForm(formData);
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });

		let invoiceRow;
		try {
			invoiceRow = await createInvoice(
				result.input,
				{ kind: 'human', email: locals.user!.email },
				'entered manually from the issued document'
			);
		} catch (error) {
			if (isPostgresConstraintViolation(error, '23505', 'invoice_contract_number_unique')) {
				return fail(400, {
					errors: { number: m.invoice_validation_number_duplicate() },
					values: result.values
				});
			}
			throw error;
		}

		redirect(303, `/invoices/${invoiceRow.id}`);
	}
};
