import { error, fail, redirect } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages';
import { getContractWithClient } from '$lib/server/repositories/contract';
import {
	attachExpenseReceipt,
	getExpense,
	getExpenseReceipts,
	updateExpense,
	type ExpenseReceiptInput
} from '$lib/server/repositories/expense';
import { parseExpenseForm } from '$lib/server/repositories/expense-form';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const contract = await getContractWithClient(params.contractId);
	if (!contract || contract.clientId !== params.id) error(404, m.contract_not_found());

	const expense = await getExpense(params.expenseId);
	if (!expense || expense.contractId !== params.contractId) error(404, m.expense_not_found());

	const receipts = await getExpenseReceipts(params.expenseId);

	return { contract, expense, existingReceiptName: receipts[0]?.originalName ?? null };
};

export const actions: Actions = {
	default: async ({ request, params }) => {
		const formData = await request.formData();
		const result = parseExpenseForm(formData);
		if (!result.ok) return fail(400, { errors: result.errors, values: result.values });

		await updateExpense(params.expenseId, result.input);

		const receiptFile = formData.get('receipt');
		if (receiptFile instanceof File && receiptFile.size > 0) {
			const receipt: ExpenseReceiptInput = {
				bytes: new Uint8Array(await receiptFile.arrayBuffer()),
				mime: receiptFile.type || 'application/octet-stream',
				originalName: receiptFile.name,
				provenance: 'upload',
				confidential: formData.get('receiptConfidential') === 'on'
			};
			await attachExpenseReceipt(params.expenseId, params.contractId, receipt);
		}

		redirect(303, `/clients/${params.id}/contracts/${params.contractId}`);
	}
};
