import { error, fail } from '@sveltejs/kit';
import { clientCrumbs } from '$lib/nav/crumbs';
import * as m from '$lib/paraglide/messages';
import { isRenewalWindowOpen, renewalWindowOpensOn } from '$lib/server/domain/contract';
import { resolveRateCard } from '$lib/server/domain/rate-card';
import { priceWorkUnitOnDate } from '$lib/server/domain/work-unit-pricing';
import { daysLate } from '$lib/server/domain/invoice';
import { listApprovalsForContract } from '$lib/server/repositories/approval';
import { getContractDocuments, getContractWithClient } from '$lib/server/repositories/contract';
import { listClauseNotes } from '$lib/server/repositories/clause-note';
import { toSourceDocumentValue } from '$lib/server/repositories/document';
import {
	listExpensesForContract,
	listInvoiceLinesForContract,
	rebillExpense
} from '$lib/server/repositories/expense';
import { listInvoicesForContract } from '$lib/server/repositories/invoice';
import { listRateCards } from '$lib/server/repositories/rate-card';
import { listWorkUnitsForContract } from '$lib/server/repositories/work-unit';
import { dayCountsTowardAmount, dayCountsTowardDays } from '../../../../day/work-unit-state';
import { minorUnitsFromMajor, sumMinorUnits, type MinorUnits } from '$lib/money';
import type { Actions, PageServerLoad } from './$types';

async function loadContract(clientId: string, contractId: string) {
	const contract = await getContractWithClient(contractId);
	if (!contract || contract.clientId !== clientId) return null;
	return contract;
}

export const load: PageServerLoad = async ({ params }) => {
	const contract = await loadContract(params.id, params.contractId);
	if (!contract) error(404, m.contract_not_found());

	const [
		rateCards,
		clauseNotes,
		expenses,
		invoiceLines,
		documents,
		approvals,
		workUnits,
		invoices
	] = await Promise.all([
		listRateCards(contract.id),
		listClauseNotes(contract.id),
		listExpensesForContract(contract.id),
		listInvoiceLinesForContract(contract.id),
		getContractDocuments(contract.id),
		listApprovalsForContract(contract.id),
		listWorkUnitsForContract(contract.id),
		listInvoicesForContract(contract.id)
	]);

	const now = new Date();
	const todayIso = now.toISOString().slice(0, 10);
	const currentYear = todayIso.slice(0, 4);

	// Every day this contract has ever carried, priced through the same
	// rate cards the day detail page prices a single day with — never a
	// second pricing path (#240's "what has this contract produced").
	const days = workUnits.map((row) => {
		const quantity = Number(row.quantity);
		const majorAmount = priceWorkUnitOnDate({ date: row.date, quantity }, rateCards);
		return {
			id: row.id,
			date: row.date,
			quantity,
			state: row.state,
			notes: row.notes,
			amount: majorAmount === null ? null : minorUnitsFromMajor(majorAmount, contract.currency)
		};
	});

	// The stat strip's first two figures (#240): days actually worked this
	// year and what they are worth, using the same "counts toward days/
	// amount" rules the month calendar already established
	// (`routes/day/work-unit-state.ts`) — never a second definition of
	// which states are "produced" versus still pending or voided.
	const daysThisYear = days
		.filter((day) => dayCountsTowardDays(day.state) && day.date.startsWith(currentYear))
		.reduce((total, day) => total + day.quantity, 0);
	const valueWorkedThisYear = sumMinorUnits(
		days
			.filter(
				(day): day is typeof day & { amount: MinorUnits } =>
					dayCountsTowardAmount(day.state) &&
					day.date.startsWith(currentYear) &&
					day.amount !== null
			)
			.map((day) => day.amount)
	);

	// The last two stats: what this contract's invoices still owe and what
	// they have already paid — every invoice ever raised against it, not
	// scoped to this year, since a receivable does not expire at New Year.
	const invoiceRows = invoices.map((row) => ({
		id: row.id,
		number: row.number,
		issueDate: row.issueDate,
		currency: row.currency,
		total: row.total,
		paidOn: row.paidOn,
		daysLate: row.paidOn === null ? daysLate(row.dueDate, now) : null
	}));
	const unpaid = invoiceRows.filter((row) => row.paidOn === null);
	const paid = invoiceRows.filter((row) => row.paidOn !== null);
	const outstanding = sumMinorUnits(unpaid.map((row) => row.total));
	const collected = sumMinorUnits(paid.map((row) => row.total));

	// The rate in force today (#14's "marked in an explicit way instead of
	// staying just another row in a flat table") — resolved once, here,
	// against the same `resolveRateCard` every invoice line and day price
	// goes through, so the contract page and the money it reports about
	// the same day never disagree about which card was in force.
	const inForceRateCard = resolveRateCard(rateCards, todayIso);

	// The trail is built here because only this query knows the client's name
	// — the same reasoning as `rate-cards/new`'s loader.
	const crumbs = clientCrumbs({
		id: contract.clientId,
		legalName: contract.client.legalName
	});

	return {
		contract,
		rateCards,
		inForceRateCardId: inForceRateCard?.id ?? null,
		clauseNotes,
		expenses,
		invoiceLines,
		days,
		invoices: invoiceRows,
		stats: {
			daysThisYear,
			valueWorkedThisYear,
			outstanding,
			outstandingCount: unpaid.length,
			collected,
			collectedCount: paid.length,
			collectedInvoiceNumber: paid.length === 1 ? paid[0].number : null
		},
		// Raw archived mail and any other document still owned by the
		// contract itself, not by one of its approvals, expenses or
		// invoices (#215's "the consent-era documents that remain").
		documents: documents.map(toSourceDocumentValue),
		// Every approval recorded against this contract (#210), newest
		// last — `documentId` is the archived proof, one click away via
		// `/documents/[id]`.
		approvals: approvals.map((row) => ({
			id: row.id,
			channel: row.channel,
			sender: row.sender,
			receivedAt: row.receivedAt.toISOString(),
			documentId: row.documentId
		})),
		crumbs,
		renewalWindowOpensOn: renewalWindowOpensOn(contract)?.toISOString().slice(0, 10) ?? null,
		renewalWindowOpen: isRenewalWindowOpen(contract, now)
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
