// Needs a migrated database: `pnpm db:up && pnpm db:migrate`. Every test
// works inside a transaction it rolls back, same pattern as
// `ceiling-status.test.ts`. Years are chosen far from other fiscal test
// files' own eras (see `profile.test.ts`'s comment on the same concern)
// since `fiscal_profile` carries a database-wide exclusion constraint on
// its validity period — this file inserts none, so every ceiling read
// here is contract-origin only, which is exactly what it means to test.

import { eq } from 'drizzle-orm';
import { afterAll, expect, test } from 'vitest';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { minorUnits } from '$lib/money';
import { client as pool, type DbExecutor } from '$lib/server/db';
import { client, contract, invoice } from '$lib/server/db/schema';
import type { ExpensePolicy, PaymentTerms } from '$lib/server/db/schema/contract';
import { createInvoice, type InvoiceInput } from '$lib/server/repositories/invoice';
import { createWorkUnit } from '$lib/server/repositories/work-unit';
import { createCeiling } from '$lib/server/repositories/ceiling';
import { emptyClientExposure, listClientExposures } from './client-exposure';

afterAll(async () => {
	await pool.end();
});

let clientCounter = 0;

function clientFields() {
	clientCounter += 1;
	return {
		legalName: `Test Client ${clientCounter}`,
		taxId: `TEST-TAX-EXPOSURE-${clientCounter}`,
		country: 'IT',
		addressLine1: 'Via Roma 1',
		addressCity: 'Milano',
		addressPostalCode: '20100',
		noticeChannel: 'email' as const
	};
}

async function insertContract(tx: DbExecutor, requiresPriorApproval = false) {
	const [clientRow] = await tx.insert(client).values(clientFields()).returning();
	const [contractRow] = await tx
		.insert(contract)
		.values({
			clientId: clientRow.id,
			title: 'Test contract',
			startsOn: '2087-01-01',
			renewalType: 'none',
			terminationNoticeDays: 30,
			paymentTerms: { kind: 'net', days: 30 } satisfies PaymentTerms,
			invoicingCadence: 'monthly',
			currency: 'EUR',
			taxTreatment: 'generic',
			expensePolicy: { kind: 'not_reimbursed' } satisfies ExpensePolicy,
			requiresPriorApproval
		})
		.returning();
	return { clientRow, contractRow };
}

function invoiceInput(contractId: string, overrides: Partial<InvoiceInput> = {}): InvoiceInput {
	return {
		contractId,
		number: `INV-${crypto.randomUUID()}`,
		issueDate: '2087-06-01',
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

test('outstanding sums only this client\u2019s unpaid invoices, collected-this-year sums only those paid within the year', async () => {
	await inRolledBackTransaction(async (tx) => {
		const { clientRow, contractRow } = await insertContract(tx);

		const unpaid = await createInvoice(
			invoiceInput(contractRow.id),
			{ kind: 'human', email: 'lorenzo@example.com' },
			'test fixture',
			tx
		);
		const paidThisYear = await createInvoice(
			invoiceInput(contractRow.id, { number: `INV-${crypto.randomUUID()}` }),
			{ kind: 'human', email: 'lorenzo@example.com' },
			'test fixture',
			tx
		);
		await tx.update(invoice).set({ paidOn: '2087-07-01' }).where(eq(invoice.id, paidThisYear.id));
		const paidLastYear = await createInvoice(
			invoiceInput(contractRow.id, { number: `INV-${crypto.randomUUID()}` }),
			{ kind: 'human', email: 'lorenzo@example.com' },
			'test fixture',
			tx
		);
		await tx.update(invoice).set({ paidOn: '2086-12-15' }).where(eq(invoice.id, paidLastYear.id));

		const exposures = await listClientExposures('2087-08-13', tx);
		const exposure = exposures.get(clientRow.id);

		expect(exposure).toBeDefined();
		expect(exposure?.outstanding).toBe(unpaid.total);
		expect(exposure?.collectedThisYear).toBe(paidThisYear.total);
	});
});

test('days this year counts a worked day and excludes a merely proposed one', async () => {
	await inRolledBackTransaction(async (tx) => {
		const { clientRow, contractRow } = await insertContract(tx);
		const actor = { kind: 'human' as const, email: 'lorenzo@example.com' };

		await createWorkUnit(
			{ contractId: contractRow.id, date: '2087-03-10', quantity: 1, scope: 'x', state: 'worked' },
			actor,
			'test fixture',
			tx
		);
		await createWorkUnit(
			{ contractId: contractRow.id, date: '2087-03-11', quantity: 1, scope: 'x' },
			actor,
			'test fixture',
			tx
		);
		// Outside the year: must not be counted.
		await createWorkUnit(
			{ contractId: contractRow.id, date: '2086-12-20', quantity: 1, scope: 'x', state: 'worked' },
			actor,
			'test fixture',
			tx
		);

		const exposures = await listClientExposures('2087-08-13', tx);
		expect(exposures.get(clientRow.id)?.daysThisYear).toBe(1);
	});
});

test('revenue share reads accrual, and a client with no revenue at all is absent from the map', async () => {
	await inRolledBackTransaction(async (tx) => {
		const heavy = await insertContract(tx);
		const light = await insertContract(tx);
		const idle = await insertContract(tx);

		await createInvoice(
			invoiceInput(heavy.contractRow.id, {
				lines: [
					{
						description: 'Consulting',
						quantity: 1,
						unitPrice: minorUnits(300_000),
						amount: minorUnits(300_000),
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
		await createInvoice(
			invoiceInput(light.contractRow.id, {
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
				]
			}),
			{ kind: 'human', email: 'lorenzo@example.com' },
			'test fixture',
			tx
		);

		const exposures = await listClientExposures('2087-08-13', tx);

		expect(exposures.get(heavy.clientRow.id)?.revenueShareThisYear).toBeCloseTo(0.75);
		expect(exposures.get(light.clientRow.id)?.revenueShareThisYear).toBeCloseTo(0.25);
		expect(exposures.has(idle.clientRow.id)).toBe(false);
		expect(emptyClientExposure(idle.clientRow.id).revenueShareThisYear).toBe(0);
	});
});

test('the concentration cap surfaces only for the client it names, evaluated the same way the dashboard reads it', async () => {
	await inRolledBackTransaction(async (tx) => {
		const capped = await insertContract(tx);
		const uncapped = await insertContract(tx);

		await createCeiling(
			{
				contractId: capped.contractRow.id,
				code: 'concentration-cap',
				label: { en: 'Concentration cap', it: 'Tetto di concentrazione' },
				legalBasis: null,
				basis: 'invoiced_calendar_year',
				measure: 'percentage_share',
				value: 0.35,
				alertLevels: [{ ratio: 0.8, label: { en: 'Approaching', it: 'In avvicinamento' } }],
				consequence: { en: 'Renegotiate.', it: 'Rinegoziare.' }
			},
			tx
		);

		await createInvoice(
			invoiceInput(capped.contractRow.id, {
				lines: [
					{
						description: 'Consulting',
						quantity: 1,
						unitPrice: minorUnits(90_000),
						amount: minorUnits(90_000),
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
		await createInvoice(
			invoiceInput(uncapped.contractRow.id, {
				lines: [
					{
						description: 'Consulting',
						quantity: 1,
						unitPrice: minorUnits(10_000),
						amount: minorUnits(10_000),
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

		const exposures = await listClientExposures('2087-08-13', tx);

		const cappedExposure = exposures.get(capped.clientRow.id);
		expect(cappedExposure?.concentrationCap).not.toBeNull();
		expect(cappedExposure?.concentrationCap?.usageRatio).toBeCloseTo(0.9 / 0.35);
		expect(cappedExposure?.concentrationCap?.crossed).toBe(true);
		// The share figure and the cap it is judged against read the same
		// basis (accrual) on purpose — see the module header.
		expect(cappedExposure?.revenueShareThisYear).toBeCloseTo(0.9);

		expect(exposures.get(uncapped.clientRow.id)?.concentrationCap).toBeNull();
	});
});
