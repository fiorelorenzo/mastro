import { error, fail, redirect } from '@sveltejs/kit';
import type { Crumb } from '$lib/nav/crumbs';
import * as m from '$lib/paraglide/messages';
import { getContractWithClient } from '$lib/server/repositories/contract';
import { createExpense } from '$lib/server/repositories/expense';
import { parseExpenseForm } from '$lib/server/repositories/expense-form';
import type { ExpenseReceiptInput } from '$lib/server/repositories/expense';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const contract = await getContractWithClient(params.contractId);
	if (!contract || contract.clientId !== params.id) error(404, m.contract_not_found());

	const crumbs: Crumb[] = [
		{ href: '/clients', label: m.clients_heading() },
		{ href: `/clients/${contract.clientId}`, label: contract.client.legalName },
		{ href: `/clients/${contract.clientId}/contracts/${contract.id}`, label: contract.title }
	];
	return { contract, crumbs };
};

export const actions: Actions = {
	default: async ({ request, params }) => {
		const formData = await request.formData();
		const result = parseExpenseForm(formData);
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });

		const receiptFile = formData.get('receipt');
		let receipt: ExpenseReceiptInput | null = null;
		if (receiptFile instanceof File && receiptFile.size > 0) {
			receipt = {
				bytes: new Uint8Array(await receiptFile.arrayBuffer()),
				mime: receiptFile.type || 'application/octet-stream',
				originalName: receiptFile.name,
				provenance: 'upload',
				confidential: formData.get('receiptConfidential') === 'on'
			};
		}

		await createExpense({ ...result.input, contractId: params.contractId }, receipt);
		redirect(303, `/clients/${params.id}/contracts/${params.contractId}`);
	}
};
