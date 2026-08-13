import * as m from '$lib/paraglide/messages';
import { legalText, type LegalText } from '$lib/legal/legal-text';
import { decimalStringToMinorUnits } from '$lib/server/import/decimal';
import { getLocale } from '$lib/paraglide/runtime';
import { invoiceDocumentType } from '$lib/server/db/schema';
import { formatDate, formatDays } from '$lib/i18n/format';
import { addMinorUnits, minorUnitsFromMajor, NO_MINOR_UNITS, type MinorUnits } from '$lib/money';
import { resolveRateCard } from '$lib/server/domain/rate-card';
import { priceWorkUnitOnDate, type PriceableRateCard } from '$lib/server/domain/work-unit-pricing';
import {
	evaluateInvoiceCharges,
	resolveDefaultTaxTreatment,
	type FiscalPack
} from '$lib/server/fiscal/pack';
import type { InvoiceDocumentType } from '$lib/server/import/invoice';
import type { InvoiceLineInput } from './invoice';

/**
 * The whole submission, echoed back verbatim on a failed validation —
 * `client-form.ts`'s own convention, a raw string per field regardless of
 * what it eventually parses into. `workUnitIds`/`expenseIds` are the two
 * repeated-checkbox groups the day and expense pickers submit; the manual
 * tax fields are read but only ever *validated* when `resolveInvoiceTax`
 * (below) finds no active pack to resolve them from — see
 * `parseManualInvoiceTax`.
 */
export type InvoiceFormValues = {
	contractId: string;
	number: string;
	issueDate: string;
	documentType: string;
	currency: string;
	dueDate: string;
	paymentMethod: string;
	iban: string;
	transmissionId: string;
	workUnitIds: string[];
	expenseIds: string[];
	manualLineDescription: string;
	manualLineAmount: string;
	taxTreatmentCode: string;
	statutoryReferenceLanguage: string;
	statutoryReferenceText: string;
	taxRate: string;
	stampDuty: string;
	socialCharge: string;
};

/** The one manual line a submission may add (#217's "genuine exception"),
 * already parsed to money — `null` when the operator left it blank. */
export type ManualInvoiceLine = { description: string; amount: MinorUnits };

/** Everything `parseInvoiceForm` can validate on its own, with no database
 * read: the document fields, which days/expenses were picked (by id, not
 * yet checked against what the contract actually has eligible — the
 * caller in `+page.server.ts` does that once it has fetched them), and the
 * one manual line. Tax fields are deliberately absent here — see
 * `resolveInvoiceTax`/`parseManualInvoiceTax`. */
export type InvoiceCoreInput = {
	contractId: string;
	number: string;
	issueDate: string;
	documentType: InvoiceDocumentType;
	currency: string;
	dueDate: string | null;
	paymentMethod: string | null;
	iban: string | null;
	transmissionId: string | null;
	workUnitIds: string[];
	expenseIds: string[];
	manualLine: ManualInvoiceLine | null;
};

export type InvoiceFormResult =
	| { ok: true; core: InvoiceCoreInput; values: InvoiceFormValues }
	| { ok: false; errors: Record<string, string>; values: InvoiceFormValues };

/**
 * Parses and validates a manual invoice submission (#217, #216). Unlike
 * the form this replaces, `quantity`/`unitPrice`/`amount` are never read
 * here at all: the day and expense pickers submit only which rows were
 * picked (`workUnitIds`/`expenseIds`, both repeated checkbox fields), and
 * `buildDayLines`/`buildExpenseLines` below price them against the
 * contract's own rate cards and expense amounts — the caller in
 * `+page.server.ts` does that once it has fetched the contract's data,
 * since pricing needs the database and this function does not touch it.
 * The one place an amount is still typed is `manualLineAmount`, for the
 * "genuine exception" #217 asks to keep.
 */
export function parseInvoiceForm(formData: FormData): InvoiceFormResult {
	const errors: Record<string, string> = {};
	const string = (key: string) => String(formData.get(key) ?? '').trim();
	const locale = getLocale();

	const contractId = string('contractId');
	if (!contractId) errors.contractId = m.invoice_validation_contract_required();

	const number = string('number');
	if (!number) errors.number = m.invoice_validation_number_required();

	const issueDate = string('issueDate');
	if (!issueDate) errors.issueDate = m.invoice_validation_issue_date_required();

	const documentType = string('documentType');
	if (!invoiceDocumentType.enumValues.includes(documentType as InvoiceDocumentType)) {
		errors.documentType = m.invoice_validation_document_type_invalid();
	}

	const currency = string('currency').toUpperCase();
	if (!/^[A-Z]{3}$/.test(currency)) errors.currency = m.invoice_validation_currency_invalid();

	const dueDate = string('dueDate');
	const paymentMethod = string('paymentMethod');
	const iban = string('iban');
	const transmissionId = string('transmissionId');

	const workUnitIds = [...new Set(formData.getAll('workUnitIds').map(String))];
	const expenseIds = [...new Set(formData.getAll('expenseIds').map(String))];

	const manualLineDescription = string('manualLineDescription');
	const manualLineAmountRaw = string('manualLineAmount');
	let manualLine: ManualInvoiceLine | null = null;
	if (manualLineDescription || manualLineAmountRaw) {
		if (!manualLineDescription) {
			errors.manualLineDescription = m.invoice_validation_manual_line_description_required();
		}
		if (!manualLineAmountRaw) {
			errors.manualLineAmount = m.invoice_validation_amount_invalid();
		} else {
			try {
				const amount = decimalStringToMinorUnits(manualLineAmountRaw, currency, locale);
				if (amount <= 0) throw new Error('non-positive');
				if (manualLineDescription) manualLine = { description: manualLineDescription, amount };
			} catch {
				errors.manualLineAmount = m.invoice_validation_amount_invalid();
			}
		}
	}

	if (workUnitIds.length === 0 && expenseIds.length === 0 && !manualLine) {
		errors.lines = m.invoice_validation_lines_required();
	}

	// The manual tax fallback fields are always read into `values` (so a
	// failed submission redisplays whatever was typed) but never validated
	// here — whether they are even needed depends on the active pack,
	// which this function has no database access to resolve. See
	// `parseManualInvoiceTax`.
	const taxTreatmentCode = string('taxTreatmentCode');
	const statutoryReferenceLanguage = string('statutoryReferenceLanguage');
	const statutoryReferenceText = string('statutoryReferenceText');
	const taxRate = string('taxRate');
	const stampDuty = string('stampDuty');
	const socialCharge = string('socialCharge');

	const values: InvoiceFormValues = {
		contractId,
		number,
		issueDate,
		documentType,
		currency,
		dueDate,
		paymentMethod,
		iban,
		transmissionId,
		workUnitIds,
		expenseIds,
		manualLineDescription,
		manualLineAmount: manualLineAmountRaw,
		taxTreatmentCode,
		statutoryReferenceLanguage,
		statutoryReferenceText,
		taxRate,
		stampDuty,
		socialCharge
	};

	if (Object.keys(errors).length > 0) return { ok: false, errors, values };

	return {
		ok: true,
		values,
		core: {
			contractId,
			number,
			issueDate,
			documentType: documentType as InvoiceDocumentType,
			currency,
			dueDate: dueDate || null,
			paymentMethod: paymentMethod || null,
			iban: iban || null,
			transmissionId: transmissionId || null,
			workUnitIds,
			expenseIds,
			manualLine
		}
	};
}

/** A line before its tax is known — every field `InvoiceLineInput` needs
 * except `taxRate`/`taxTreatmentCode`, which are the same for every line
 * on one invoice (#216: the whole document takes one resolved treatment,
 * never a line-by-line pick) and are folded in once, by the caller, after
 * `resolveInvoiceTax` runs. */
export type UnratedInvoiceLine = Omit<InvoiceLineInput, 'taxRate' | 'taxTreatmentCode'>;

export type PriceableDay = {
	readonly id: string;
	readonly date: string;
	readonly quantity: number;
};

export type DayLinesResult =
	| { readonly ok: true; readonly lines: readonly UnratedInvoiceLine[] }
	| { readonly ok: false; readonly unpricedDayIds: readonly string[] };

/**
 * One line per rate card in force among `days` (#217): a month that never
 * crossed a rate change comes back as one line, a month that did comes
 * back as two, oldest rate card first. `quantity` is the group's own
 * `quantity` sum — a day fraction or an hours figure, whichever the card's
 * `kind` uses (`work-unit-pricing.ts`) — and `unitPrice` is that card's
 * own rate; `amount` is always the sum of `priceWorkUnitOnDate` per day,
 * never `quantity * unitPrice`, the same reasoning `invoice_line.amount`'s
 * own schema comment already gives for keeping `amount` its own column.
 * That is also the property under test: a line's amount is exactly what
 * its days price to, nothing this function derives independently and
 * could drift from.
 *
 * A day whose date no rate card in force covers, or whose quantity the
 * card in force rejects (`priceWorkUnitOnDate` returning `null`), fails
 * the whole batch rather than pricing it at zero — a day the calendar
 * cannot honestly price is never silently dropped from the total.
 */
export function buildDayLines(
	days: readonly PriceableDay[],
	rateCards: PriceableRateCard[],
	currency: string
): DayLinesResult {
	const groups = new Map<
		string,
		{ card: PriceableRateCard; days: PriceableDay[]; amount: MinorUnits }
	>();
	const unpricedDayIds: string[] = [];

	for (const day of days) {
		const card = resolveRateCard(rateCards, day.date);
		const price = card ? priceWorkUnitOnDate(day, rateCards) : null;
		if (!card || price === null) {
			unpricedDayIds.push(day.id);
			continue;
		}
		const amount = minorUnitsFromMajor(price, currency);
		const existing = groups.get(card.id);
		if (existing) {
			existing.days.push(day);
			existing.amount = addMinorUnits(existing.amount, amount);
		} else {
			groups.set(card.id, { card, days: [day], amount });
		}
	}

	if (unpricedDayIds.length > 0) return { ok: false, unpricedDayIds };

	const orderedGroups = [...groups.values()].toSorted((a, b) =>
		a.card.validFrom < b.card.validFrom ? -1 : a.card.validFrom > b.card.validFrom ? 1 : 0
	);

	const lines: UnratedInvoiceLine[] = orderedGroups.map((group) => {
		const quantity = group.days.reduce((sum, day) => sum + day.quantity, 0);
		const dates = group.days.map((day) => day.date).toSorted();
		const from = dates[0];
		const to = dates[dates.length - 1];
		const description =
			from === to
				? m.invoice_form_line_days_description_single({
						count: formatDays(group.days.length),
						date: formatDate(from)
					})
				: m.invoice_form_line_days_description_range({
						count: formatDays(group.days.length),
						from: formatDate(from),
						to: formatDate(to)
					});
		return {
			description,
			quantity,
			unitPrice: minorUnitsFromMajor(group.card.amount, currency),
			amount: group.amount,
			workUnitIds: group.days.map((day) => day.id),
			expenseIds: []
		};
	});

	return { ok: true, lines };
}

export type PriceableExpense = {
	readonly id: string;
	readonly description: string;
	readonly amount: MinorUnits;
};

/** One line per expense to rebill (#217) — never folded into the day
 * lines above, so a reader can always tell an expense pass-through from
 * billed work at a glance. */
export function buildExpenseLines(expenses: readonly PriceableExpense[]): UnratedInvoiceLine[] {
	return expenses.map((expense) => ({
		description: m.invoice_form_line_expense_description({ description: expense.description }),
		quantity: 1,
		unitPrice: expense.amount,
		amount: expense.amount,
		workUnitIds: [],
		expenseIds: [expense.id]
	}));
}

/** The one manual line, built the same shape as every computed one so the
 * caller can concatenate them without a special case — carrying neither a
 * `workUnitIds` nor an `expenseIds` entry is what marks it manual: every
 * other line this module builds always carries at least one. */
export function buildManualLine(manualLine: ManualInvoiceLine): UnratedInvoiceLine {
	return {
		description: manualLine.description,
		quantity: 1,
		unitPrice: manualLine.amount,
		amount: manualLine.amount,
		workUnitIds: [],
		expenseIds: []
	};
}

export type ResolvedInvoiceTax =
	| {
			readonly source: 'pack';
			readonly treatmentCode: string | null;
			readonly taxRate: number;
			readonly statutoryReference: LegalText | null;
			readonly stampDuty: MinorUnits | null;
			readonly socialCharge: MinorUnits | null;
	  }
	| { readonly source: 'manual' };

/**
 * The tax outcome the whole invoice takes — document and every line alike;
 * this domain never splits a treatment across lines (#216). Resolved from
 * `pack`, the fiscal profile in force on the invoice's own issue date, when
 * it has an opinion (`resolveDefaultTaxTreatment`); `'manual'` otherwise —
 * no active profile at all, or one whose pack does not model a default
 * treatment (`generic`) — the escape hatch `parseManualInvoiceTax` reads.
 *
 * `taxableAmount` is the sum of the lines already built (`buildDayLines`/
 * `buildExpenseLines`/`buildManualLine`), fed to the pack's charges as the
 * `invoiceTotal` fact — computing it first and resolving tax second, never
 * the other way round, is what keeps this pure: a line's amount never
 * depends on its own tax rate, only the other way round.
 */
export function resolveInvoiceTax(
	pack: FiscalPack | null,
	taxableAmount: MinorUnits
): ResolvedInvoiceTax {
	const treatment = pack ? resolveDefaultTaxTreatment(pack) : null;
	if (!pack || !treatment) return { source: 'manual' };

	const charges = evaluateInvoiceCharges(pack, { invoiceTotal: taxableAmount });
	return {
		source: 'pack',
		treatmentCode: treatment.code,
		taxRate: treatment.taxRate,
		statutoryReference: treatment.legalText,
		stampDuty: charges.stampDuty,
		socialCharge: charges.socialCharge
	};
}

export type ManualInvoiceTax = {
	taxTreatmentCode: string | null;
	taxRate: number;
	statutoryReference: LegalText | null;
	stampDuty: MinorUnits | null;
	socialCharge: MinorUnits | null;
};

/**
 * Validates the freeform tax fields `parseInvoiceForm` reads but never
 * itself checks — the manual fallback for a jurisdiction `resolveInvoiceTax`
 * has no opinion about (#216). Only ever called when it doesn't: the
 * normal, pack-resolved path never reaches this function, so a modelled
 * pack's invoice can never be blocked by a validation rule written for the
 * fallback case.
 */
export function parseManualInvoiceTax(
	values: InvoiceFormValues,
	currency: string
): { ok: true; tax: ManualInvoiceTax } | { ok: false; errors: Record<string, string> } {
	const errors: Record<string, string> = {};
	const locale = getLocale();

	if (values.statutoryReferenceText && !values.statutoryReferenceLanguage) {
		errors.statutoryReferenceLanguage =
			m.invoice_validation_statutory_reference_language_required();
	}

	const taxRate = Number(values.taxRate);
	if (!values.taxRate || !Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
		errors.taxRate = m.invoice_validation_tax_rate_invalid();
	}

	let stampDuty: MinorUnits | null = null;
	if (values.stampDuty) {
		try {
			stampDuty = decimalStringToMinorUnits(values.stampDuty, currency, locale);
		} catch {
			errors.stampDuty = m.invoice_validation_amount_invalid();
		}
	}

	let socialCharge: MinorUnits | null = null;
	if (values.socialCharge) {
		try {
			socialCharge = decimalStringToMinorUnits(values.socialCharge, currency, locale);
		} catch {
			errors.socialCharge = m.invoice_validation_amount_invalid();
		}
	}

	if (Object.keys(errors).length > 0) return { ok: false, errors };

	return {
		ok: true,
		tax: {
			taxTreatmentCode: values.taxTreatmentCode || null,
			taxRate,
			statutoryReference: values.statutoryReferenceText
				? legalText(values.statutoryReferenceLanguage, values.statutoryReferenceText)
				: null,
			stampDuty,
			socialCharge
		}
	};
}

/** `NO_MINOR_UNITS`-typed convenience re-export so `+page.server.ts` does
 * not need its own import of `$lib/money` for the one zero it needs when
 * previewing tax before any line exists. */
export const NO_TAXABLE_AMOUNT: MinorUnits = NO_MINOR_UNITS;
