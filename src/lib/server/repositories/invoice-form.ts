import * as m from '$lib/paraglide/messages';
import { legalText } from '$lib/legal/legal-text';
import { decimalStringToMinorUnits } from '$lib/server/import/decimal';
import { getLocale } from '$lib/paraglide/runtime';
import { invoiceDocumentType } from '$lib/server/db/schema';
import type { MinorUnits } from '$lib/money';
import type { InvoiceDocumentType } from '$lib/server/import/invoice';
import type { InvoiceInput, InvoiceLineInput } from './invoice';

export type InvoiceLineFormValues = {
	description: string;
	quantity: string;
	unitPrice: string;
	amount: string;
	taxRate: string;
	taxTreatmentCode: string;
	workUnitIds: string[];
};

export type InvoiceFormValues = {
	contractId: string;
	number: string;
	issueDate: string;
	documentType: string;
	currency: string;
	taxTreatmentCode: string;
	statutoryReferenceLanguage: string;
	statutoryReferenceText: string;
	stampDuty: string;
	socialCharge: string;
	dueDate: string;
	paymentMethod: string;
	iban: string;
	transmissionId: string;
	lines: InvoiceLineFormValues[];
};

export type InvoiceFormResult =
	| { ok: true; input: InvoiceInput; values: InvoiceFormValues }
	| { ok: false; errors: Record<string, string>; values: InvoiceFormValues };

/**
 * Parses and validates a manual invoice submission (#26). Line rows are
 * addressed as `lineDescription_0`, `lineQuantity_0`, ... up to
 * `lineCount` (exclusive), the same indexed-slot convention
 * `client-form.ts` uses for contacts; a row with no description is a spare
 * blank slot, dropped silently. Each line's chosen days arrive as
 * `lineDays_{i}`, a repeated checkbox field (`formData.getAll`).
 *
 * Amounts are read as decimal strings and converted with
 * `decimalStringToMinorUnits` — never `Number(...)` directly — so a
 * mistyped amount is rejected instead of silently drifting through a
 * float (`import/decimal.ts`).
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

	const taxTreatmentCode = string('taxTreatmentCode');
	const statutoryReferenceLanguage = string('statutoryReferenceLanguage');
	const statutoryReferenceText = string('statutoryReferenceText');
	if (statutoryReferenceText && !statutoryReferenceLanguage) {
		errors.statutoryReferenceLanguage =
			m.invoice_validation_statutory_reference_language_required();
	}

	const stampDutyRaw = string('stampDuty');
	let stampDuty: MinorUnits | null = null;
	if (stampDutyRaw) {
		try {
			stampDuty = decimalStringToMinorUnits(stampDutyRaw, currency, locale);
		} catch {
			errors.stampDuty = m.invoice_validation_amount_invalid();
		}
	}

	const socialChargeRaw = string('socialCharge');
	let socialCharge: MinorUnits | null = null;
	if (socialChargeRaw) {
		try {
			socialCharge = decimalStringToMinorUnits(socialChargeRaw, currency, locale);
		} catch {
			errors.socialCharge = m.invoice_validation_amount_invalid();
		}
	}

	const dueDate = string('dueDate');
	const paymentMethod = string('paymentMethod');
	const iban = string('iban');
	const transmissionId = string('transmissionId');

	const lineCount = Number(formData.get('lineCount') ?? 0);
	const lineValues: InvoiceLineFormValues[] = [];
	const lines: InvoiceLineInput[] = [];
	for (let i = 0; i < lineCount; i++) {
		const description = string(`lineDescription_${i}`);
		const quantityRaw = string(`lineQuantity_${i}`);
		const unitPriceRaw = string(`lineUnitPrice_${i}`);
		const amountRaw = string(`lineAmount_${i}`);
		const taxRateRaw = string(`lineTaxRate_${i}`);
		const lineTaxTreatmentCode = string(`lineTaxTreatmentCode_${i}`);
		const workUnitIds = formData.getAll(`lineDays_${i}`).map(String);

		lineValues.push({
			description,
			quantity: quantityRaw,
			unitPrice: unitPriceRaw,
			amount: amountRaw,
			taxRate: taxRateRaw,
			taxTreatmentCode: lineTaxTreatmentCode,
			workUnitIds
		});

		if (!description) continue; // untouched spare row

		const quantity = Number(quantityRaw);
		if (!quantityRaw || !Number.isFinite(quantity) || quantity <= 0) {
			errors[`lineQuantity_${i}`] = m.invoice_validation_quantity_invalid();
			continue;
		}

		let unitPrice: MinorUnits;
		let amount: MinorUnits;
		try {
			unitPrice = decimalStringToMinorUnits(unitPriceRaw, currency, locale);
			amount = decimalStringToMinorUnits(amountRaw, currency, locale);
		} catch {
			errors[`lineAmount_${i}`] = m.invoice_validation_amount_invalid();
			continue;
		}

		const taxRate = Number(taxRateRaw);
		if (!taxRateRaw || !Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
			errors[`lineTaxRate_${i}`] = m.invoice_validation_tax_rate_invalid();
			continue;
		}

		lines.push({
			description,
			quantity,
			unitPrice,
			amount,
			taxRate,
			taxTreatmentCode: lineTaxTreatmentCode || null,
			workUnitIds
		});
	}
	if (lines.length === 0) errors.lines = m.invoice_validation_lines_required();

	// A day picked under more than one line in the same submission would
	// otherwise be silently reassigned from the first line to the last
	// (`transitionWorkUnit` sees no state change on the second call, so the
	// state-machine trigger's edge check never fires for it) — rejected
	// here instead of letting that happen quietly.
	const seenWorkUnitIds = new Set<string>();
	for (const line of lines) {
		for (const workUnitId of line.workUnitIds) {
			if (seenWorkUnitIds.has(workUnitId)) {
				errors.lines = m.invoice_validation_duplicate_day();
			}
			seenWorkUnitIds.add(workUnitId);
		}
	}

	const values: InvoiceFormValues = {
		contractId,
		number,
		issueDate,
		documentType,
		currency,
		taxTreatmentCode,
		statutoryReferenceLanguage,
		statutoryReferenceText,
		stampDuty: stampDutyRaw,
		socialCharge: socialChargeRaw,
		dueDate,
		paymentMethod,
		iban,
		transmissionId,
		lines: lineValues
	};

	if (Object.keys(errors).length > 0) return { ok: false, errors, values };

	return {
		ok: true,
		values,
		input: {
			contractId,
			number,
			issueDate,
			documentType: documentType as InvoiceDocumentType,
			currency,
			taxTreatmentCode: taxTreatmentCode || null,
			statutoryReference: statutoryReferenceText
				? legalText(statutoryReferenceLanguage, statutoryReferenceText)
				: null,
			stampDuty,
			socialCharge,
			dueDate: dueDate || null,
			paymentMethod: paymentMethod || null,
			iban: iban || null,
			transmissionId: transmissionId || null,
			lines
		}
	};
}
