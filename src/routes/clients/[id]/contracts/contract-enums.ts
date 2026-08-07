import * as m from '$lib/paraglide/messages';

/**
 * Plain literal lists mirroring the `contract` table's own Postgres enums
 * (`$lib/server/db/schema/contract.ts`), duplicated here rather than
 * imported the same way `routes/clients/notice-channel.ts` duplicates
 * `notice_channel`: these are used from client components, and
 * `$lib/server/db/schema` cannot be bundled into client code.
 */
export const contractRenewalTypes = ['none', 'explicit', 'counterparty_option', 'tacit'] as const;
export type ContractRenewalTypeValue = (typeof contractRenewalTypes)[number];

export const invoicingCadences = ['monthly', 'quarterly', 'annual', 'on_completion'] as const;
export type InvoicingCadenceValue = (typeof invoicingCadences)[number];

export const contractStatuses = ['draft', 'active', 'terminated', 'expired'] as const;
export type ContractStatusValue = (typeof contractStatuses)[number];

// Not a database enum — the two `PaymentTerms` discriminated-union shapes
// the contract form lets a user pick between.
export const paymentTermsKinds = ['net', 'day_of_month'] as const;
export type PaymentTermsKindValue = (typeof paymentTermsKinds)[number];

// Likewise not a database enum — the three `ExpensePolicy` shapes.
export const expensePolicyKinds = [
	'not_reimbursed',
	'reimbursed_at_cost',
	'reimbursed_with_cap'
] as const;
export type ExpensePolicyKindValue = (typeof expensePolicyKinds)[number];

export function renewalTypeLabel(value: ContractRenewalTypeValue): string {
	switch (value) {
		case 'none':
			return m.contract_renewal_type_none();
		case 'explicit':
			return m.contract_renewal_type_explicit();
		case 'counterparty_option':
			return m.contract_renewal_type_counterparty_option();
		case 'tacit':
			return m.contract_renewal_type_tacit();
	}
}

export function invoicingCadenceLabel(value: InvoicingCadenceValue): string {
	switch (value) {
		case 'monthly':
			return m.contract_invoicing_cadence_monthly();
		case 'quarterly':
			return m.contract_invoicing_cadence_quarterly();
		case 'annual':
			return m.contract_invoicing_cadence_annual();
		case 'on_completion':
			return m.contract_invoicing_cadence_on_completion();
	}
}

export function statusLabel(value: ContractStatusValue): string {
	switch (value) {
		case 'draft':
			return m.contract_status_draft();
		case 'active':
			return m.contract_status_active();
		case 'terminated':
			return m.contract_status_terminated();
		case 'expired':
			return m.contract_status_expired();
	}
}

export function paymentTermsKindLabel(value: PaymentTermsKindValue): string {
	switch (value) {
		case 'net':
			return m.contract_payment_terms_kind_net();
		case 'day_of_month':
			return m.contract_payment_terms_kind_day_of_month();
	}
}

export function expensePolicyKindLabel(value: ExpensePolicyKindValue): string {
	switch (value) {
		case 'not_reimbursed':
			return m.contract_expense_policy_kind_not_reimbursed();
		case 'reimbursed_at_cost':
			return m.contract_expense_policy_kind_reimbursed_at_cost();
		case 'reimbursed_with_cap':
			return m.contract_expense_policy_kind_reimbursed_with_cap();
	}
}
