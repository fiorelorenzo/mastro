import { fail, redirect } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages';
import { invoicesCrumbs } from '$lib/nav/crumbs';
import { db } from '$lib/server/db';
import { isPostgresConstraintViolation } from '$lib/server/db/postgres-error';
import { resolveRateCard } from '$lib/server/domain/rate-card';
import { priceWorkUnitOnDate } from '$lib/server/domain/work-unit-pricing';
import { resolveActiveFiscalPack } from '$lib/server/fiscal/profile';
import { listContractsWithClient } from '$lib/server/repositories/contract';
import { listEligibleExpensesForRebilling } from '$lib/server/repositories/expense';
import {
	createInvoice,
	listCorrectableInvoicesForContract,
	type InvoiceInput,
	type InvoiceLineInput
} from '$lib/server/repositories/invoice';
import {
	buildDayLines,
	buildExpenseLines,
	buildManualLine,
	NO_TAXABLE_AMOUNT,
	parseInvoiceForm,
	parseManualInvoiceTax,
	resolveInvoiceTax,
	type UnratedInvoiceLine
} from '$lib/server/repositories/invoice-form';
import { listRateCards } from '$lib/server/repositories/rate-card';
import { listEligibleWorkUnitsForInvoicing } from '$lib/server/repositories/work-unit';
import { minorUnitsFromMajor, sumMinorUnits } from '$lib/money';
import type { Actions, PageServerLoad } from './$types';

// Contract selection happens in a GET step (`?contractId=`) before the
// creation form is usable: which days are eligible to bill (#26) depends
// on the contract, so there is nothing meaningful to offer as a day picker
// until one is chosen.
export const load: PageServerLoad = async ({ url }) => {
	const contracts = await listContractsWithClient();
	const contractId = url.searchParams.get('contractId') ?? '';
	const selectedContract = contracts.find((c) => c.id === contractId) ?? null;

	const [rateCards, eligibleDaysRaw, eligibleExpensesRaw, activePack, correctableInvoicesRaw] =
		contractId
			? await Promise.all([
					listRateCards(contractId),
					listEligibleWorkUnitsForInvoicing(contractId),
					listEligibleExpensesForRebilling(contractId),
					resolveActiveFiscalPack(db, new Date().toISOString().slice(0, 10)),
					listCorrectableInvoicesForContract(contractId)
				])
			: [[], [], [], null, []];

	const currency = selectedContract?.currency ?? '';

	// Priced up front, at load time, so the day picker's running total
	// (#217's "changing the selection changes the total") is a client-side
	// sum over data already on the page — no round trip needed to see it
	// change. `rateCardId` lets the client group checked days by card the
	// same way `buildDayLines` will at submission time, purely for the
	// live preview; the submission itself always re-prices from scratch.
	const eligibleDays = eligibleDaysRaw.map((day) => {
		const card = resolveRateCard(rateCards, day.date);
		const price = card
			? priceWorkUnitOnDate({ date: day.date, quantity: Number(day.quantity) }, rateCards)
			: null;
		return {
			id: day.id,
			date: day.date,
			quantity: Number(day.quantity),
			scope: day.scope,
			rateCardId: card?.id ?? null,
			amount: price === null || !currency ? null : minorUnitsFromMajor(price, currency)
		};
	});

	const eligibleExpenses = eligibleExpensesRaw.map((expense) => ({
		id: expense.id,
		date: expense.date,
		description: expense.description,
		amount: expense.amount
	}));

	// The credit-note picker's own list (#213) — every ordinary invoice on
	// this contract, so choosing one and defaulting the correction's line
	// from it is a client-side lookup over data already on the page, the
	// same "no round trip" choice `eligibleDays`/`eligibleExpenses` make.
	const correctableInvoices = correctableInvoicesRaw.map((row) => ({
		id: row.id,
		number: row.number,
		issueDate: row.issueDate,
		taxableAmount: row.taxableAmount,
		total: row.total,
		currency: row.currency
	}));

	// A preview only — resolved against today, since the issue date is not
	// typed yet on a fresh form. The actual invoice always re-resolves
	// against whatever issue date is actually submitted (see the action
	// below), so a stale preview here can never produce a wrong invoice,
	// only a momentarily misleading one.
	const taxPreview = resolveInvoiceTax(activePack?.pack ?? null, NO_TAXABLE_AMOUNT);

	const crumbs = invoicesCrumbs();
	return {
		contracts,
		selectedContractId: contractId,
		eligibleDays,
		eligibleExpenses,
		correctableInvoices,
		taxPreview,
		crumbs
	};
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const formData = await request.formData();
		const parsed = parseInvoiceForm(formData);
		if (!parsed.ok) return fail(400, { errors: parsed.errors, values: parsed.values });
		const { core, values } = parsed;

		const [rateCards, eligibleDays, eligibleExpenses, correctableInvoices] = await Promise.all([
			listRateCards(core.contractId),
			listEligibleWorkUnitsForInvoicing(core.contractId),
			listEligibleExpensesForRebilling(core.contractId),
			listCorrectableInvoicesForContract(core.contractId)
		]);

		const eligibleDaysById = new Map(eligibleDays.map((day) => [day.id, day]));
		const eligibleExpensesById = new Map(eligibleExpenses.map((expense) => [expense.id, expense]));

		if (core.workUnitIds.some((id) => !eligibleDaysById.has(id))) {
			return fail(400, {
				errors: { workUnitIds: m.invoice_validation_workunit_ineligible() },
				values
			});
		}
		if (core.expenseIds.some((id) => !eligibleExpensesById.has(id))) {
			return fail(400, {
				errors: { expenseIds: m.invoice_validation_expense_ineligible() },
				values
			});
		}
		if (
			core.correctsInvoiceId &&
			!correctableInvoices.some((invoiceRow) => invoiceRow.id === core.correctsInvoiceId)
		) {
			return fail(400, {
				errors: { correctsInvoiceId: m.invoice_validation_corrects_invoice_ineligible() },
				values
			});
		}

		const selectedDays = core.workUnitIds.map((id) => {
			const day = eligibleDaysById.get(id)!;
			return { id: day.id, date: day.date, quantity: Number(day.quantity) };
		});
		const dayLinesResult = buildDayLines(selectedDays, rateCards, core.currency);
		if (!dayLinesResult.ok) {
			return fail(400, { errors: { workUnitIds: m.invoice_validation_day_unpriced() }, values });
		}

		const selectedExpenses = core.expenseIds.map((id) => {
			const expense = eligibleExpensesById.get(id)!;
			return { id: expense.id, description: expense.description, amount: expense.amount };
		});
		const expenseLines = buildExpenseLines(selectedExpenses);
		const manualLines = core.manualLine ? [buildManualLine(core.manualLine)] : [];

		const baseLines: UnratedInvoiceLine[] = [
			...dayLinesResult.lines,
			...expenseLines,
			...manualLines
		];
		const taxableAmount = sumMinorUnits(baseLines.map((line) => line.amount));

		const resolvedPack = await resolveActiveFiscalPack(db, core.issueDate);
		const tax = resolveInvoiceTax(resolvedPack?.pack ?? null, taxableAmount);

		let taxTreatmentCode: string | null;
		let taxRate: number;
		let statutoryReference: InvoiceInput['statutoryReference'];
		let stampDuty: InvoiceInput['stampDuty'];
		let socialCharge: InvoiceInput['socialCharge'];

		if (tax.source === 'pack') {
			taxTreatmentCode = tax.treatmentCode;
			taxRate = tax.taxRate;
			statutoryReference = tax.statutoryReference;
			stampDuty = tax.stampDuty;
			socialCharge = tax.socialCharge;
		} else {
			const manualTax = parseManualInvoiceTax(values, core.currency);
			if (!manualTax.ok) return fail(400, { errors: manualTax.errors, values });
			taxTreatmentCode = manualTax.tax.taxTreatmentCode;
			taxRate = manualTax.tax.taxRate;
			statutoryReference = manualTax.tax.statutoryReference;
			stampDuty = manualTax.tax.stampDuty;
			socialCharge = manualTax.tax.socialCharge;
		}

		const lines: InvoiceLineInput[] = baseLines.map((line) => ({
			...line,
			taxRate,
			taxTreatmentCode
		}));

		let invoiceRow;
		try {
			invoiceRow = await createInvoice(
				{
					contractId: core.contractId,
					number: core.number,
					issueDate: core.issueDate,
					documentType: core.documentType,
					currency: core.currency,
					taxTreatmentCode,
					statutoryReference,
					stampDuty,
					socialCharge,
					dueDate: core.dueDate,
					paymentMethod: core.paymentMethod,
					iban: core.iban,
					transmissionId: core.transmissionId,
					correctsInvoiceId: core.correctsInvoiceId,
					lines
				},
				{ kind: 'human', email: locals.user!.email },
				'entered manually from the issued document'
			);
		} catch (error) {
			if (isPostgresConstraintViolation(error, '23505', 'invoice_number_unique')) {
				return fail(400, {
					errors: { number: m.invoice_validation_number_duplicate() },
					values
				});
			}
			if (
				isPostgresConstraintViolation(error, '23514', 'invoice_credit_note_not_exceeding_original')
			) {
				return fail(400, {
					errors: { manualLineAmount: m.invoice_validation_credit_note_exceeds_original() },
					values
				});
			}
			if (
				isPostgresConstraintViolation(
					error,
					'23514',
					'invoice_corrects_invoice_id_targets_ordinary_invoice'
				)
			) {
				return fail(400, {
					errors: { correctsInvoiceId: m.invoice_validation_corrects_invoice_ineligible() },
					values
				});
			}
			throw error;
		}

		redirect(303, `/invoices/${invoiceRow.id}`);
	}
};
