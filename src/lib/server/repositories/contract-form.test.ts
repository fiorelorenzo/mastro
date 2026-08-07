import { expect, test } from 'vitest';
import { parseContractForm } from './contract-form';

function formData(fields: Record<string, string>): FormData {
	const data = new FormData();
	for (const [key, value] of Object.entries(fields)) data.set(key, value);
	return data;
}

const validBase = {
	title: 'Consulting agreement',
	signedDocumentReference: '',
	startsOn: '2024-01-01',
	endsOn: '',
	renewalType: 'none',
	renewalNoticeDays: '',
	terminationNoticeDays: '30',
	paymentTermsKind: 'net',
	paymentTermsNetDays: '30',
	paymentTermsDayOfMonthDay: '',
	invoicingCadence: 'monthly',
	currency: 'eur',
	taxTreatment: 'generic',
	expensePolicyKind: 'not_reimbursed',
	expensePolicyCapAmount: '',
	templateLanguage: 'en',
	status: 'draft'
};

test('accepts a valid net-terms, no-renewal submission and uppercases the currency', () => {
	const result = parseContractForm(formData(validBase));
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error('expected ok');
	expect(result.input.currency).toBe('EUR');
	expect(result.input.paymentTerms).toEqual({ kind: 'net', days: 30 });
	expect(result.input.renewalNoticeDays).toBeNull();
});

test('accepts a day-of-month payment terms submission', () => {
	const result = parseContractForm(
		formData({ ...validBase, paymentTermsKind: 'day_of_month', paymentTermsDayOfMonthDay: '15' })
	);
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error('expected ok');
	expect(result.input.paymentTerms).toEqual({ kind: 'day_of_month', day: 15, monthOffset: 1 });
});

test('requires renewal_notice_days for every renewal type but none', () => {
	const result = parseContractForm(
		formData({ ...validBase, renewalType: 'tacit', renewalNoticeDays: '' })
	);
	expect(result.ok).toBe(false);
	if (result.ok) throw new Error('expected errors');
	expect(result.errors.renewalNoticeDays).toBeDefined();
});

test('accepts a tacit renewal with a notice period', () => {
	const result = parseContractForm(
		formData({ ...validBase, renewalType: 'tacit', renewalNoticeDays: '30' })
	);
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error('expected ok');
	expect(result.input.renewalType).toBe('tacit');
	expect(result.input.renewalNoticeDays).toBe(30);
});

test('accepts a reimbursed_with_cap expense policy and converts the cap to minor units', () => {
	const result = parseContractForm(
		formData({
			...validBase,
			expensePolicyKind: 'reimbursed_with_cap',
			expensePolicyCapAmount: '5000.00'
		})
	);
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error('expected ok');
	expect(result.input.expensePolicy).toEqual({ kind: 'reimbursed_with_cap', capAmount: 500000 });
});

test('rejects requiring expense pre-authorisation on a not_reimbursed policy', () => {
	const data = formData(validBase);
	data.set('requiresExpensePreAuthorisation', 'on');
	const result = parseContractForm(data);
	expect(result.ok).toBe(false);
	if (result.ok) throw new Error('expected errors');
	expect(result.errors.requiresExpensePreAuthorisation).toBeDefined();
});

test('rejects a missing title', () => {
	const result = parseContractForm(formData({ ...validBase, title: '' }));
	expect(result.ok).toBe(false);
	if (result.ok) throw new Error('expected errors');
	expect(result.errors.title).toBeDefined();
});

test('rejects a currency that is not a three-letter code', () => {
	const result = parseContractForm(formData({ ...validBase, currency: 'euro' }));
	expect(result.ok).toBe(false);
	if (result.ok) throw new Error('expected errors');
	expect(result.errors.currency).toBeDefined();
});

test('rejects a template language the enum does not carry', () => {
	const result = parseContractForm(formData({ ...validBase, templateLanguage: 'de' }));
	expect(result.ok).toBe(false);
	if (result.ok) throw new Error('expected a rejection');
	expect(result.errors.templateLanguage).toBeTruthy();
});

test('carries the contract-level template language through to the input', () => {
	const result = parseContractForm(formData({ ...validBase, templateLanguage: 'it' }));
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error('expected ok');
	expect(result.input.templateLanguage).toBe('it');
});
