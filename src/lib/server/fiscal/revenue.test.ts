// Needs a migrated database: `pnpm db:up && pnpm db:migrate`. Every test
// works inside a transaction it rolls back, same pattern as
// `profile.test.ts`.

import { afterAll, expect, test } from 'vitest';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { client as pool, type DbExecutor } from '$lib/server/db';
import { minorUnits } from '$lib/money';
import { client, contract } from '$lib/server/db/schema';
import type { ExpensePolicy, PaymentTerms } from '$lib/server/db/schema/contract';
import { fiscalProfile } from '$lib/server/db/schema/fiscal';
import { createInvoice, recordPayment, type InvoiceInput } from '$lib/server/repositories/invoice';
import { fetchClientRevenueBreakdown, fetchLedgerRows, fetchRevenueOverRange } from './revenue';
import { buildRegistry, type PackRegistry } from './registry';
import type { FiscalPack } from './pack';

afterAll(async () => {
	await pool.end();
});

let clientCounter = 0;

function clientFields() {
	clientCounter += 1;
	return {
		legalName: `Test Client ${clientCounter}`,
		taxId: `TEST-TAX-REVENUE-${clientCounter}`,
		country: 'IT',
		addressLine1: 'Via Roma 1',
		addressCity: 'Milano',
		addressPostalCode: '20100',
		noticeChannel: 'email' as const
	};
}

async function insertContract(
	tx: DbExecutor,
	paymentTerms: PaymentTerms = { kind: 'net', days: 30 }
) {
	const [clientRow] = await tx.insert(client).values(clientFields()).returning();
	const [contractRow] = await tx
		.insert(contract)
		.values({
			clientId: clientRow.id,
			title: 'Test contract',
			startsOn: '2024-01-01',
			renewalType: 'none',
			terminationNoticeDays: 30,
			paymentTerms,
			invoicingCadence: 'monthly',
			currency: 'EUR',
			taxTreatment: 'generic',
			expensePolicy: { kind: 'not_reimbursed' } satisfies ExpensePolicy
		})
		.returning();
	return { clientRow, contractRow };
}

function invoiceInput(contractId: string, overrides: Partial<InvoiceInput> = {}): InvoiceInput {
	return {
		contractId,
		number: `INV-${crypto.randomUUID()}`,
		issueDate: '2024-06-01',
		documentType: 'invoice',
		currency: 'EUR',
		taxTreatmentCode: null,
		statutoryReference: null,
		stampDuty: null,
		socialCharge: null,
		dueDate: null,
		paymentMethod: null,
		iban: null,
		transmissionId: null,
		lines: [
			{
				description: 'Consulting',
				quantity: 1,
				unitPrice: minorUnits(100_000),
				amount: minorUnits(100_000),
				taxRate: 0,
				taxTreatmentCode: null,
				workUnitIds: []
			}
		],
		...overrides
	};
}

test('fetchLedgerRows carries taxable_amount plus social_charge as revenue, never VAT or stamp duty', async () => {
	await inRolledBackTransaction(async (tx) => {
		const { clientRow, contractRow } = await insertContract(tx);
		const invoiceRow = await createInvoice(
			invoiceInput(contractRow.id, {
				socialCharge: minorUnits(4_000),
				stampDuty: minorUnits(200),
				lines: [
					{
						description: 'Consulting',
						quantity: 1,
						unitPrice: minorUnits(100_000),
						amount: minorUnits(100_000),
						taxRate: 22,
						taxTreatmentCode: null,
						workUnitIds: []
					}
				]
			}),
			{ kind: 'human', email: 'lorenzo@example.com' },
			'test fixture',
			tx
		);
		// taxable 100,000 + tax 22,000 + stamp 200 + social 4,000 = 126,200
		expect(invoiceRow.total).toBe(126_200);

		const rows = await fetchLedgerRows(tx);
		const row = rows.find((r) => r.invoiceId === invoiceRow.id);
		expect(row?.clientId).toBe(clientRow.id);
		// Revenue counted is taxable_amount + social_charge, excluding
		// both VAT and stamp duty.
		expect(row?.amount).toBe(100_000 + 4_000);
	});
});

test('fetchLedgerRows negates a credit note\u2019s amount (#213), and leaves a debit note untouched', async () => {
	await inRolledBackTransaction(async (tx) => {
		const { contractRow } = await insertContract(tx);
		const original = await createInvoice(
			invoiceInput(contractRow.id),
			{ kind: 'human', email: 'lorenzo@example.com' },
			'test fixture',
			tx
		);

		const creditNote = await createInvoice(
			invoiceInput(contractRow.id, {
				documentType: 'credit_note',
				correctsInvoiceId: original.id,
				lines: [
					{
						description: 'Correction',
						quantity: 1,
						unitPrice: minorUnits(30_000),
						amount: minorUnits(30_000),
						taxRate: 0,
						taxTreatmentCode: null,
						workUnitIds: []
					}
				]
			}),
			{ kind: 'human', email: 'lorenzo@example.com' },
			'test fixture',
			tx
		);

		const debitNote = await createInvoice(
			invoiceInput(contractRow.id, {
				documentType: 'debit_note',
				correctsInvoiceId: original.id,
				lines: [
					{
						description: 'Under-billed correction',
						quantity: 1,
						unitPrice: minorUnits(5_000),
						amount: minorUnits(5_000),
						taxRate: 0,
						taxTreatmentCode: null,
						workUnitIds: []
					}
				]
			}),
			{ kind: 'human', email: 'lorenzo@example.com' },
			'test fixture',
			tx
		);

		const rows = await fetchLedgerRows(tx);
		expect(rows.find((r) => r.invoiceId === original.id)?.amount).toBe(100_000);
		// The one figure #213 is about: a credit note subtracts from
		// revenue instead of adding to it.
		expect(rows.find((r) => r.invoiceId === creditNote.id)?.amount).toBe(-30_000);
		// A debit note corrects an *under*-billed amount — it still adds,
		// same as an ordinary invoice.
		expect(rows.find((r) => r.invoiceId === debitNote.id)?.amount).toBe(5_000);
	});
});

test('fetchLedgerRows carries both dates, payments empty until collected', async () => {
	await inRolledBackTransaction(async (tx) => {
		const { contractRow } = await insertContract(tx);
		const invoiceRow = await createInvoice(
			invoiceInput(contractRow.id),
			{ kind: 'human', email: 'lorenzo@example.com' },
			'test fixture',
			tx
		);

		const beforePayment = await fetchLedgerRows(tx);
		expect(beforePayment.find((r) => r.invoiceId === invoiceRow.id)?.payments).toEqual([]);

		await recordPayment(invoiceRow.id, { amount: invoiceRow.total, date: '2024-07-05' }, tx);

		const afterPayment = await fetchLedgerRows(tx);
		const row = afterPayment.find((r) => r.invoiceId === invoiceRow.id);
		expect(row?.payments).toEqual([{ date: '2024-07-05', amount: invoiceRow.total }]);
		expect(row?.issueDate).toBe('2024-06-01');
	});
});

// Each test below owns its own safely-past era (1950, 1951, 1954): past
// every real regime's start, so none can ever collide with an instance's
// own current, open-ended `fiscal_profile` row — see `profile.test.ts`'s
// header comment on why a future era, however distant, does not have
// this property.
test('fetchRevenueOverRange sums under the sole pack in force for a range with no regime change', async () => {
	await inRolledBackTransaction(async (tx) => {
		const { contractRow } = await insertContract(tx);
		const invoiceRow = await createInvoice(
			invoiceInput(contractRow.id, { issueDate: '1950-03-01' }),
			{ kind: 'human', email: 'lorenzo@example.com' },
			'test fixture',
			tx
		);
		await recordPayment(invoiceRow.id, { amount: invoiceRow.total, date: '1950-03-10' }, tx);

		const cashPack: FiscalPack = {
			id: 'test-revenue-cash',
			version: '1',
			effectiveFrom: '2024-01-01',
			displayName: { en: 'Test cash', it: 'Test cash' },
			basis: 'cash',
			fiscalYear: { startMonth: 1, startDay: 1 },
			ceilings: [],
			treatments: [],
			charges: [],
			formats: [],
			unresolvedRevenue: 'carries_forward'
		};
		const registry: PackRegistry = buildRegistry([cashPack]);
		await tx.delete(fiscalProfile);
		await tx.insert(fiscalProfile).values({
			packId: 'test-revenue-cash',
			packVersion: '1',
			validFrom: '1950-01-01',
			validTo: null
		});

		const figure = await fetchRevenueOverRange('1950-01-01', '1951-01-01', tx, registry);

		expect(figure.amount).toBe(100_000);
		expect(figure.subFigures).toEqual([
			{
				basis: 'cash',
				from: '1950-01-01',
				to: '1951-01-01',
				amount: 100_000,
				packId: 'test-revenue-cash'
			}
		]);
	});
});

test('fetchRevenueOverRange sums each sub-period under its own basis across a regime change', async () => {
	await inRolledBackTransaction(async (tx) => {
		const { contractRow } = await insertContract(tx);

		// Issued and paid before the switch: counted under the cash
		// sub-period's basis regardless of which reading would agree.
		const beforeSwitch = await createInvoice(
			invoiceInput(contractRow.id, { issueDate: '1951-02-01' }),
			{ kind: 'human', email: 'lorenzo@example.com' },
			'test fixture',
			tx
		);
		await recordPayment(beforeSwitch.id, { amount: beforeSwitch.total, date: '1951-02-10' }, tx);

		// Issued after the switch to accrual, never paid: still counted,
		// because the sub-period it falls in reads by issue date.
		await createInvoice(
			invoiceInput(contractRow.id, {
				issueDate: '1951-08-01',
				lines: [
					{
						description: 'Consulting',
						quantity: 1,
						unitPrice: minorUnits(60_000),
						amount: minorUnits(60_000),
						taxRate: 0,
						taxTreatmentCode: null,
						workUnitIds: []
					}
				]
			}),
			{ kind: 'human', email: 'lorenzo@example.com' },
			'test fixture',
			tx
		);

		const cashPack: FiscalPack = {
			id: 'test-regime-cash',
			version: '1',
			effectiveFrom: '2024-01-01',
			displayName: { en: 'x', it: 'x' },
			basis: 'cash',
			fiscalYear: { startMonth: 1, startDay: 1 },
			ceilings: [],
			treatments: [],
			charges: [],
			formats: [],
			unresolvedRevenue: 'carries_forward'
		};
		const accrualPack: FiscalPack = { ...cashPack, id: 'test-regime-accrual', basis: 'accrual' };
		const registry: PackRegistry = buildRegistry([cashPack, accrualPack]);

		await tx.insert(fiscalProfile).values({
			packId: 'test-regime-cash',
			packVersion: '1',
			validFrom: '1951-01-01',
			validTo: '1951-07-01'
		});
		await tx.insert(fiscalProfile).values({
			packId: 'test-regime-accrual',
			packVersion: '1',
			validFrom: '1951-07-01',
			validTo: '1952-01-01'
		});

		const figure = await fetchRevenueOverRange('1951-01-01', '1952-01-01', tx, registry);

		expect(figure.subFigures).toEqual([
			{
				basis: 'cash',
				from: '1951-01-01',
				to: '1951-07-01',
				amount: 100_000,
				packId: 'test-regime-cash'
			},
			{
				basis: 'accrual',
				from: '1951-07-01',
				to: '1952-01-01',
				amount: 60_000,
				packId: 'test-regime-accrual'
			}
		]);
		expect(figure.amount).toBe(160_000);
	});
});

// 1954 (and 1953 for the out-of-range client): its own safely-past era —
// see the earlier tests' own comment on this file.
test('fetchClientRevenueBreakdown splits revenue by client under the pack in force, leaving an out-of-range client out', async () => {
	await inRolledBackTransaction(async (tx) => {
		const { clientRow: clientA, contractRow: contractA } = await insertContract(tx);
		const { clientRow: clientB, contractRow: contractB } = await insertContract(tx);

		// In range and paid: counted for client A.
		const invoiceA = await createInvoice(
			invoiceInput(contractA.id, { issueDate: '1954-03-01' }),
			{ kind: 'human', email: 'lorenzo@example.com' },
			'test fixture',
			tx
		);
		await recordPayment(invoiceA.id, { amount: invoiceA.total, date: '1954-03-10' }, tx);

		// Client B only has revenue before the queried range: left out of
		// `byClient` entirely rather than listed at zero.
		const invoiceB = await createInvoice(
			invoiceInput(contractB.id, {
				issueDate: '1953-11-01',
				lines: [
					{
						description: 'Consulting',
						quantity: 1,
						unitPrice: minorUnits(60_000),
						amount: minorUnits(60_000),
						taxRate: 0,
						taxTreatmentCode: null,
						workUnitIds: []
					}
				]
			}),
			{ kind: 'human', email: 'lorenzo@example.com' },
			'test fixture',
			tx
		);
		await recordPayment(invoiceB.id, { amount: invoiceB.total, date: '1953-11-05' }, tx);

		const cashPack: FiscalPack = {
			id: 'test-client-breakdown-cash',
			version: '1',
			effectiveFrom: '2024-01-01',
			displayName: { en: 'Test cash', it: 'Test cash' },
			basis: 'cash',
			fiscalYear: { startMonth: 1, startDay: 1 },
			ceilings: [],
			treatments: [],
			charges: [],
			formats: [],
			unresolvedRevenue: 'carries_forward'
		};
		const registry: PackRegistry = buildRegistry([cashPack]);
		// Its own distant, safely-past era. Clears the table first, inside
		// its own rolled-back transaction — a real seeded "current regime"
		// row cannot be dodged with an earlier start date, since two
		// open-ended ranges always overlap regardless of where either starts
		// (see `profile.test.ts`'s `makeRoomForOwnProfiles` comment).
		await tx.delete(fiscalProfile);
		await tx.insert(fiscalProfile).values({
			packId: 'test-client-breakdown-cash',
			packVersion: '1',
			validFrom: '1954-01-01',
			validTo: null
		});

		const breakdown = await fetchClientRevenueBreakdown('1954-01-01', '1955-01-01', tx, registry);

		expect(breakdown.byClient).toEqual([{ clientId: clientA.id, amount: 100_000 }]);
		expect(breakdown.total).toBe(100_000);
		expect(breakdown.byClient.some((share) => share.clientId === clientB.id)).toBe(false);
	});
});
