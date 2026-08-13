import { afterAll, expect, test } from 'vitest';
import { client as pool, db } from '$lib/server/db';
import { client, contract } from '$lib/server/db/schema';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { createWorkUnit, listWorkUnitTransitions } from './work-unit';
import { parseContractForm } from './contract-form';

// #211: the two DB-backed tests near the bottom need a real Postgres
// connection (`pnpm db:up && pnpm db:migrate`) — same convention as
// `work-unit.test.ts` and `worked-without-approval.test.ts`: real
// transactions, always rolled back (`inRolledBackTransaction`), never a
// mocked trigger.
afterAll(async () => {
	await pool.end();
});

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
	requiresPriorApproval: 'not_required',
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

test('rejects a missing prior-approval choice — nothing chosen never silently becomes "not required"', () => {
	const withoutApproval: Record<string, string> = { ...validBase };
	delete withoutApproval.requiresPriorApproval;
	const result = parseContractForm(formData(withoutApproval));
	expect(result.ok).toBe(false);
	if (result.ok) throw new Error('expected errors');
	expect(result.errors.requiresPriorApproval).toBeDefined();
});

test('rejects a prior-approval value the two-option control never sends', () => {
	const result = parseContractForm(formData({ ...validBase, requiresPriorApproval: 'maybe' }));
	expect(result.ok).toBe(false);
	if (result.ok) throw new Error('expected errors');
	expect(result.errors.requiresPriorApproval).toBeDefined();
});

test('maps the "required" choice to requiresPriorApproval: true', () => {
	const result = parseContractForm(formData({ ...validBase, requiresPriorApproval: 'required' }));
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error('expected ok');
	expect(result.input.requiresPriorApproval).toBe(true);
});

test('maps the "not_required" choice to requiresPriorApproval: false', () => {
	const result = parseContractForm(
		formData({ ...validBase, requiresPriorApproval: 'not_required' })
	);
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error('expected ok');
	expect(result.input.requiresPriorApproval).toBe(false);
});

async function insertClient(tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) {
	const [row] = await tx
		.insert(client)
		.values({
			legalName: `Test Client ${crypto.randomUUID()}`,
			taxId: `TEST-TAX-${crypto.randomUUID()}`,
			country: 'IT',
			addressLine1: 'Via Roma 1',
			addressCity: 'Milano',
			addressPostalCode: '20100',
			noticeChannel: 'email' as const
		})
		.returning();
	return row;
}

// #211's acceptance: the approval rule is a decision the person made on
// the form, and it is provable in the transition log — not just in the
// `contract` row. Both branches go through the exact path a submission
// does: `parseContractForm` first, then a real insert, then a day
// recorded `worked` with no approval linked, same as `worked-without-
// approval.test.ts` exercises directly against a hand-built contract.
// This test proves the form's two choices reach that same state machine
// correctly, not just that the trigger itself works.
test.each([
	['required', 'worked_without_approval'],
	['not_required', 'worked']
] as const)(
	'choosing "%s" on the form sends an unapproved worked day to "%s", logged in the transition log',
	async (choice, expectedState) => {
		await inRolledBackTransaction(async (tx) => {
			const clientRow = await insertClient(tx);
			const result = parseContractForm(
				formData({ ...validBase, status: 'active', requiresPriorApproval: choice })
			);
			expect(result.ok).toBe(true);
			if (!result.ok) throw new Error('expected ok');
			expect(result.input.requiresPriorApproval).toBe(choice === 'required');

			const [contractRow] = await tx
				.insert(contract)
				.values({ ...result.input, clientId: clientRow.id })
				.returning();

			const workUnitRow = await createWorkUnit(
				{
					contractId: contractRow.id,
					date: '2024-06-12',
					quantity: 1,
					scope: 'Delivered the agreed workshop.',
					state: 'worked'
				},
				{ kind: 'human', email: 'test@example.com' },
				'recorded the same day it happened',
				tx
			);
			expect(workUnitRow.state).toBe(expectedState);

			const transitions = await listWorkUnitTransitions(workUnitRow.id, tx);
			expect(transitions.at(-1)).toMatchObject({ fromState: null, toState: expectedState });
		});
	}
);
