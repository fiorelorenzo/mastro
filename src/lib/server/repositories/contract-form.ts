import * as m from '$lib/paraglide/messages';
import { decimalStringToMinorUnits } from '$lib/server/import/decimal';
import {
	contractRenewalType,
	contractStatus,
	contractTemplateLanguage,
	invoicingCadence,
	type ContractRenewalType,
	type ContractStatus,
	type ContractTemplateLanguage,
	type ExpensePolicy,
	type InvoicingCadence,
	type PaymentTerms
} from '$lib/server/db/schema';
import type { ContractInput } from './contract';

export type ContractFormValues = {
	title: string;
	signedDocumentReference: string;
	startsOn: string;
	endsOn: string;
	renewalType: string;
	renewalNoticeDays: string;
	terminationNoticeDays: string;
	paymentTermsKind: string;
	paymentTermsNetDays: string;
	paymentTermsDayOfMonthDay: string;
	invoicingCadence: string;
	currency: string;
	taxTreatment: string;
	requiresPriorApproval: boolean;
	expensePolicyKind: string;
	expensePolicyCapAmount: string;
	requiresExpensePreAuthorisation: boolean;
	templateLanguage: string;
	status: string;
};

export type ContractFormResult =
	| { ok: true; input: Omit<ContractInput, 'clientId'>; values: ContractFormValues }
	| { ok: false; errors: Record<string, string>; values: ContractFormValues };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parses and validates a contract create/edit submission (#105) — every
 * field `ContractInput` takes, including both `payment_terms` shapes and
 * all four renewal types. `clientId` is deliberately not read here: it
 * comes from the route (`/clients/[id]/contracts/...`), never from the
 * submitted body, so the caller sets it on the parsed input afterward.
 *
 * Constraints the database itself enforces (`renewal_notice_days` required
 * for every renewal type but `none`, `ends_on >= starts_on`, the overlap
 * exclusion on rate cards elsewhere) are not re-derived here beyond what a
 * usable form needs before submitting — the database is still the
 * authority; see `isPostgresConstraintViolation` at the call site for the
 * one that can only be caught after the write is attempted.
 */
export function parseContractForm(formData: FormData): ContractFormResult {
	const errors: Record<string, string> = {};
	const string = (key: string) => String(formData.get(key) ?? '').trim();

	const title = string('title');
	if (!title) errors.title = m.contract_validation_title_required();

	const signedDocumentReference = string('signedDocumentReference');

	const startsOn = string('startsOn');
	if (!ISO_DATE.test(startsOn)) errors.startsOn = m.contract_validation_starts_on_required();

	const endsOn = string('endsOn');
	if (endsOn && !ISO_DATE.test(endsOn)) errors.endsOn = m.contract_validation_ends_on_invalid();

	const renewalTypeRaw = string('renewalType');
	if (!contractRenewalType.enumValues.includes(renewalTypeRaw as ContractRenewalType)) {
		errors.renewalType = m.contract_validation_renewal_type_invalid();
	}
	const renewalType = renewalTypeRaw as ContractRenewalType;

	const renewalNoticeDaysRaw = string('renewalNoticeDays');
	let renewalNoticeDays: number | null = null;
	if (renewalType !== 'none') {
		const days = Number(renewalNoticeDaysRaw);
		if (!renewalNoticeDaysRaw || !Number.isInteger(days) || days < 0) {
			errors.renewalNoticeDays = m.contract_validation_renewal_notice_days_required();
		} else {
			renewalNoticeDays = days;
		}
	}

	const terminationNoticeDaysRaw = string('terminationNoticeDays');
	const terminationNoticeDays = Number(terminationNoticeDaysRaw);
	if (
		!terminationNoticeDaysRaw ||
		!Number.isInteger(terminationNoticeDays) ||
		terminationNoticeDays < 0
	) {
		errors.terminationNoticeDays = m.contract_validation_termination_notice_days_invalid();
	}

	const paymentTermsKind = string('paymentTermsKind');
	const paymentTermsNetDaysRaw = string('paymentTermsNetDays');
	const paymentTermsDayOfMonthDayRaw = string('paymentTermsDayOfMonthDay');
	let paymentTerms: PaymentTerms | null = null;
	if (paymentTermsKind === 'net') {
		const days = Number(paymentTermsNetDaysRaw);
		if (!paymentTermsNetDaysRaw || !Number.isInteger(days) || days <= 0) {
			errors.paymentTermsNetDays = m.contract_validation_payment_terms_net_days_invalid();
		} else {
			paymentTerms = { kind: 'net', days };
		}
	} else if (paymentTermsKind === 'day_of_month') {
		const day = Number(paymentTermsDayOfMonthDayRaw);
		if (!paymentTermsDayOfMonthDayRaw || !Number.isInteger(day) || day < 1 || day > 31) {
			errors.paymentTermsDayOfMonthDay = m.contract_validation_payment_terms_day_invalid();
		} else {
			paymentTerms = { kind: 'day_of_month', day, monthOffset: 1 };
		}
	} else {
		errors.paymentTermsKind = m.contract_validation_payment_terms_kind_invalid();
	}

	const invoicingCadenceRaw = string('invoicingCadence');
	if (!invoicingCadence.enumValues.includes(invoicingCadenceRaw as InvoicingCadence)) {
		errors.invoicingCadence = m.contract_validation_invoicing_cadence_invalid();
	}

	const currency = string('currency').toUpperCase();
	if (!/^[A-Z]{3}$/.test(currency)) errors.currency = m.contract_validation_currency_invalid();

	const taxTreatment = string('taxTreatment');
	if (!taxTreatment) errors.taxTreatment = m.contract_validation_tax_treatment_required();

	const requiresPriorApproval = formData.get('requiresPriorApproval') === 'on';

	const expensePolicyKind = string('expensePolicyKind');
	const expensePolicyCapAmountRaw = string('expensePolicyCapAmount');
	let expensePolicy: ExpensePolicy | null = null;
	if (expensePolicyKind === 'not_reimbursed' || expensePolicyKind === 'reimbursed_at_cost') {
		expensePolicy = { kind: expensePolicyKind };
	} else if (expensePolicyKind === 'reimbursed_with_cap') {
		try {
			const capAmount = decimalStringToMinorUnits(expensePolicyCapAmountRaw, currency);
			if (capAmount <= 0) throw new Error('non-positive');
			expensePolicy = { kind: 'reimbursed_with_cap', capAmount };
		} catch {
			errors.expensePolicyCapAmount = m.contract_validation_expense_policy_cap_amount_invalid();
		}
	} else {
		errors.expensePolicyKind = m.contract_validation_expense_policy_kind_invalid();
	}

	const requiresExpensePreAuthorisation = formData.get('requiresExpensePreAuthorisation') === 'on';
	if (requiresExpensePreAuthorisation && expensePolicyKind === 'not_reimbursed') {
		errors.requiresExpensePreAuthorisation =
			m.contract_validation_expense_preauth_requires_reimbursement();
	}

	const statusRaw = string('status');
	if (!contractStatus.enumValues.includes(statusRaw as ContractStatus)) {
		errors.status = m.contract_validation_status_invalid();
	}

	// The language this client is written to (#69). A property of the
	// counterparty, not of whoever is looking at the screen, so it is stored
	// on the contract and never read from the active interface locale.
	const templateLanguageRaw = string('templateLanguage');
	if (
		!contractTemplateLanguage.enumValues.includes(templateLanguageRaw as ContractTemplateLanguage)
	) {
		errors.templateLanguage = m.contract_validation_template_language_invalid();
	}

	const values: ContractFormValues = {
		title,
		signedDocumentReference,
		startsOn,
		endsOn,
		renewalType: renewalTypeRaw,
		renewalNoticeDays: renewalNoticeDaysRaw,
		terminationNoticeDays: terminationNoticeDaysRaw,
		paymentTermsKind,
		paymentTermsNetDays: paymentTermsNetDaysRaw,
		paymentTermsDayOfMonthDay: paymentTermsDayOfMonthDayRaw,
		invoicingCadence: invoicingCadenceRaw,
		currency,
		taxTreatment,
		requiresPriorApproval,
		expensePolicyKind,
		expensePolicyCapAmount: expensePolicyCapAmountRaw,
		requiresExpensePreAuthorisation,
		templateLanguage: templateLanguageRaw,
		status: statusRaw
	};

	if (Object.keys(errors).length > 0 || !paymentTerms || !expensePolicy) {
		return { ok: false, errors, values };
	}

	return {
		ok: true,
		values,
		input: {
			title,
			signedDocumentReference: signedDocumentReference || null,
			startsOn,
			endsOn: endsOn || null,
			renewalType,
			renewalNoticeDays,
			terminationNoticeDays,
			paymentTerms,
			invoicingCadence: invoicingCadenceRaw as InvoicingCadence,
			currency,
			taxTreatment,
			requiresPriorApproval,
			expensePolicy,
			requiresExpensePreAuthorisation,
			templateLanguage: templateLanguageRaw as ContractTemplateLanguage,
			status: statusRaw as ContractStatus
		}
	};
}
