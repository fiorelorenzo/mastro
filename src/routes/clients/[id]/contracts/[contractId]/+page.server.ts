import { error, fail } from '@sveltejs/kit';
import { clientCrumbs } from '$lib/nav/crumbs';
import * as m from '$lib/paraglide/messages';
import { renewalWindowOpensOn } from '$lib/server/domain/contract';
import {
	getContractWithClient,
	revokeHostedExtractionConsent,
	setHostedExtractionConsentDocument
} from '$lib/server/repositories/contract';
import { getDocument } from '$lib/server/repositories/document';
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

	const [rateCards, clauseNotes, expenses, invoiceLines, consentDocument] = await Promise.all([
		listRateCards(contract.id),
		listClauseNotes(contract.id),
		listExpensesForContract(contract.id),
		listInvoiceLinesForContract(contract.id),
		// #187: the evidence behind the extraction gate, named on the page
		// rather than left as a uuid only SQL can read.
		contract.hostedExtractionConsentDocumentId
			? getDocument(contract.hostedExtractionConsentDocumentId)
			: null
	]);

	// The trail is built here because only this query knows the client's name
	// — the same reasoning as `rate-cards/new`'s loader.
	const crumbs = clientCrumbs({
		id: contract.clientId,
		legalName: contract.client.legalName
	});

	return {
		contract,
		rateCards,
		clauseNotes,
		expenses,
		invoiceLines,
		consentDocument: consentDocument
			? { id: consentDocument.id, originalName: consentDocument.originalName }
			: null,
		crumbs,
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
	},

	// #187. The file is required, not optional: a contract may only be
	// marked consenting by pointing at the document that proves it, which
	// is what `setHostedExtractionConsentDocument` enforces in one
	// transaction. A flag with no evidence is the unfalsifiable claim #81
	// rejected.
	setConsent: async ({ request, params }) => {
		const contract = await loadContract(params.id, params.contractId);
		if (!contract) error(404, m.contract_not_found());

		const formData = await request.formData();
		const file = formData.get('consent');
		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { consentError: m.consent_validation_document_required() });
		}

		await setHostedExtractionConsentDocument(contract.id, {
			bytes: new Uint8Array(await file.arrayBuffer()),
			mime: file.type || 'application/octet-stream',
			originalName: file.name,
			provenance: 'upload',
			// A client's written agreement about its own engagement is
			// confidential by default, the same as every other document
			// under this contract.
			confidential: true
		});
		return { consentSet: true };
	},

	// Clears the link and leaves the document. Consent given and later
	// withdrawn is history, not a mistake to erase, and it takes effect on
	// the next job: nothing already sent can be recalled.
	withdrawConsent: async ({ params }) => {
		const contract = await loadContract(params.id, params.contractId);
		if (!contract) error(404, m.contract_not_found());

		await revokeHostedExtractionConsent(contract.id);
		return { consentWithdrawn: true };
	}
};
