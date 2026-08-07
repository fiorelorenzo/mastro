import { error, fail } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages';
import { renewalWindowOpensOn } from '$lib/server/domain/contract';
import { getContractWithClient } from '$lib/server/repositories/contract';
import { listClauseNotes } from '$lib/server/repositories/clause-note';
import {
	listExpensesForContract,
	listInvoiceLinesForContract,
	rebillExpense
} from '$lib/server/repositories/expense';
import { listRateCards } from '$lib/server/repositories/rate-card';
import type { Actions, PageServerLoad } from './$types';

async function loadContract(clientId: string, contractId: string) {
	const contract = await getContractWithClient(contractId);
	if (!contract || contract.clientId !== clientId) return null;
	return contract;
}

export const load: PageServerLoad = async ({ params }) => {
	const contract = await loadContract(params.id, params.contractId);
	if (!contract) error(404, m.contract_not_found());

	const [rateCards, clauseNotes, expenses, invoiceLines] = await Promise.all([
		listRateCards(contract.id),
		listClauseNotes(contract.id),
		listExpensesForContract(contract.id),
		listInvoiceLinesForContract(contract.id)
	]);

	return {
		contract,
		rateCards,
		clauseNotes,
		expenses,
		invoiceLines,
		renewalWindowOpensOn: renewalWindowOpensOn(contract)?.toISOString().slice(0, 10) ?? null
	};
};

export const actions: Actions = {
	rebill: async ({ request, params }) => {
		const contract = await loadContract(params.id, params.contractId);
		if (!contract) error(404, m.contract_not_found());

		const formData = await request.formData();
		const expenseId = String(formData.get('expenseId') ?? '').trim();
		const invoiceLineId = String(formData.get('invoiceLineId') ?? '').trim();

		const expenses = await listExpensesForContract(contract.id);
		const expenseRow = expenses.find((row) => row.id === expenseId);
		if (!expenseRow) return fail(400, { rebillError: m.expense_validation_expense_invalid() });
		if (expenseRow.invoiceLineId) {
			return fail(400, { rebillError: m.expense_validation_already_rebilled() });
		}

		const invoiceLines = await listInvoiceLinesForContract(contract.id);
		if (!invoiceLineId || !invoiceLines.some((line) => line.id === invoiceLineId)) {
			return fail(400, { rebillError: m.expense_validation_invoice_line_invalid() });
		}

		await rebillExpense(expenseId, invoiceLineId);
		return { rebilled: true };
	}
};
