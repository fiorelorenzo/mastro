// Needs a migrated database: `pnpm db:up && pnpm db:migrate`. Every test
// works inside a transaction it rolls back, same pattern as
// `forecast.test.ts`. Years are chosen far apart per test (and far from
// other fiscal test files' own eras — see `profile.test.ts`'s comment on
// the same concern) since `fiscal_profile` carries a database-wide
// exclusion constraint on its validity period — and always in the past,
// since a real instance's *current* regime is open-ended and therefore
// unsafe to collide with at any future date, however distant.

import { afterAll, expect, test } from 'vitest';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { minorUnits } from '$lib/money';
import { client as pool, type DbExecutor } from '$lib/server/db';
import { client, contract } from '$lib/server/db/schema';
import type { ExpensePolicy, PaymentTerms } from '$lib/server/db/schema/contract';
import { fiscalProfile } from '$lib/server/db/schema/fiscal';
import { createInvoice, recordPayment, type InvoiceInput } from '$lib/server/repositories/invoice';
import { createCeiling } from '$lib/server/repositories/ceiling';
import { evaluateActiveCeilings } from './ceiling-status';
import type { FiscalPack } from './pack';
import { buildRegistry, type PackRegistry } from './registry';

afterAll(async () => {
	await pool.end();
});

let clientCounter = 0;

function clientFields() {
	clientCounter += 1;
	return {
		legalName: `Test Client ${clientCounter}`,
		taxId: `TEST-TAX-CEILSTATUS-${clientCounter}`,
		country: 'IT',
		addressLine1: 'Via Roma 1',
		addressCity: 'Milano',
		addressPostalCode: '20100',
		noticeChannel: 'email' as const
	};
}

async function insertContract(tx: DbExecutor) {
	const [clientRow] = await tx.insert(client).values(clientFields()).returning();
	const [contractRow] = await tx
		.insert(contract)
		.values({
			clientId: clientRow.id,
			title: 'Test contract',
			startsOn: '2091-01-01',
			renewalType: 'none',
			terminationNoticeDays: 30,
			paymentTerms: { kind: 'net', days: 30 } satisfies PaymentTerms,
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
		issueDate: '1940-06-01',
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

test('a pack ceiling and a persisted contract ceiling both appear, evaluated by the same call', async () => {
	await inRolledBackTransaction(async (tx) => {
		const { clientRow, contractRow } = await insertContract(tx);
		const invoiceRow = await createInvoice(
			invoiceInput(contractRow.id),
			{ kind: 'human', email: 'lorenzo@example.com' },
			'test fixture',
			tx
		);
		await recordPayment(invoiceRow.id, { amount: invoiceRow.total, date: '1940-06-10' }, tx);

		await createCeiling(
			{
				contractId: contractRow.id,
				code: 'client-share-cap',
				label: { en: 'Client share cap', it: 'Tetto quota cliente' },
				legalBasis: null,
				basis: 'cash_received_calendar_year',
				measure: 'percentage_share',
				value: 0.5,
				alertLevels: [],
				consequence: { en: 'Renegotiate.', it: 'Rinegoziare.' }
			},
			tx
		);

		const pack: FiscalPack = {
			id: 'test-ceiling-status-pack',
			version: '1',
			effectiveFrom: '2024-01-01',
			displayName: { en: 'x', it: 'x' },
			basis: 'cash',
			fiscalYear: { startMonth: 1, startDay: 1 },
			ceilings: [
				{
					id: 'test-pack-cap',
					origin: 'pack',
					label: { en: 'Pack cap', it: 'Tetto pacchetto' },
					measure: 'absolute_amount',
					value: minorUnits(500_000),
					basis: 'cash_received_calendar_year',
					perimeter: { kind: 'all_clients' },
					alertLevels: [],
					consequence: { en: 'x', it: 'x' }
				}
			],
			treatments: [],
			charges: [],
			formats: [],
			unresolvedRevenue: 'carries_forward'
		};
		const registry: PackRegistry = buildRegistry([pack]);
		await tx.delete(fiscalProfile);
		await tx.insert(fiscalProfile).values({
			packId: 'test-ceiling-status-pack',
			packVersion: '1',
			validFrom: '1940-01-01',
			validTo: null
		});

		const evaluated = await evaluateActiveCeilings('1940-06-15', tx, registry);

		const packResult = evaluated.find((e) => e.ceiling.id === 'test-pack-cap');
		const contractResult = evaluated.find((e) => e.ceiling.id === 'client-share-cap');

		expect(packResult).toBeDefined();
		expect(packResult?.ceiling.origin).toBe('pack');
		expect(packResult?.currentValue).toBe(100_000);

		expect(contractResult).toBeDefined();
		expect(contractResult?.ceiling.origin).toBe('contract');
		expect(contractResult?.ceiling.perimeter).toEqual({ kind: 'client', clientId: clientRow.id });
		expect(contractResult?.currentValue).toBe(100_000); // this client is the only revenue
		expect(contractResult?.limitValue).toBe(Math.round(100_000 * 0.5));
	});
});

test('a contract ceiling survives a fiscal profile switch with no pack ceilings, while the pack set empties', async () => {
	await inRolledBackTransaction(async (tx) => {
		const { contractRow } = await insertContract(tx);
		await createCeiling(
			{
				contractId: contractRow.id,
				code: 'survives-regime-change',
				label: { en: 'x', it: 'x' },
				legalBasis: null,
				basis: 'cash_received_calendar_year',
				measure: 'absolute_amount',
				value: minorUnits(1_000_000),
				alertLevels: [],
				consequence: { en: 'x', it: 'x' }
			},
			tx
		);

		const packWithoutCeilings: FiscalPack = {
			id: 'test-ceiling-status-empty',
			version: '1',
			effectiveFrom: '2024-01-01',
			displayName: { en: 'x', it: 'x' },
			basis: 'accrual',
			fiscalYear: { startMonth: 1, startDay: 1 },
			ceilings: [],
			treatments: [],
			charges: [],
			formats: [],
			unresolvedRevenue: 'carries_forward'
		};
		const registry: PackRegistry = buildRegistry([packWithoutCeilings]);
		await tx.delete(fiscalProfile);
		await tx.insert(fiscalProfile).values({
			packId: 'test-ceiling-status-empty',
			packVersion: '1',
			validFrom: '1941-01-01',
			validTo: null
		});

		const evaluated = await evaluateActiveCeilings('1941-03-01', tx, registry);

		// Scoped to this test's own contract ceiling by its own unique code:
		// with no pack ceilings, every evaluated entry is a contract
		// ceiling, and a populated database (a seeded instance) may carry
		// other contracts' own.
		const ownEvaluated = evaluated.filter((e) => e.ceiling.id === 'survives-regime-change');
		expect(ownEvaluated).toHaveLength(1);
		expect(ownEvaluated[0].ceiling.id).toBe('survives-regime-change');
		expect(ownEvaluated[0].ceiling.origin).toBe('contract');
	});
});

/**
 * #336, decided on the #324 spike: a pack ceiling measures what its own
 * regime recognised, not everything that happened to land inside its reset
 * period. Era 1943 here, disjoint from every other test in this file.
 *
 * Two regimes inside one calendar year, both cash: pack A through 30 June,
 * pack B from 1 July, each declaring its own absolute ceiling. Three
 * payments, placed either side of the boundary on purpose.
 *
 * The interesting one is the invoice issued under A and collected under B.
 * It counts toward **B**, and that is deliberate rather than an oversight
 * of the carry-forward pass: both regimes recognise on receipt, so the
 * receipt is the recognition event under either one, and Legge 190/2014
 * comma 72 does not move a recognition date — it says revenue that has
 * already contributed is never counted twice, and revenue that has not
 * becomes relevant in the later period. That revenue had contributed to
 * nothing under A, since no money had arrived. The carry-forward machinery
 * (#122) exists for the case where the two regimes disagree about *what*
 * recognises revenue, cash giving way to accrual, and this is not that.
 *
 * What the fix changes is the 1 March payment: A recognised it, A's cap
 * measured it, and B must not measure it again. Before #336 the whole
 * calendar year was summed under one basis, so B read all three.
 */
test('a pack ceiling counts only the revenue its own regime recognised, not the whole calendar year', async () => {
	const outcome = await inRolledBackTransaction(async (tx) => {
		const { contractRow } = await insertContract(tx);

		const underA = await createInvoice(
			invoiceInput(contractRow.id, { issueDate: '1943-02-01' }),
			{ kind: 'human', email: 'lorenzo@example.com' },
			'test fixture',
			tx
		);
		const straddling = await createInvoice(
			invoiceInput(contractRow.id, { issueDate: '1943-05-01' }),
			{ kind: 'human', email: 'lorenzo@example.com' },
			'test fixture',
			tx
		);
		const underB = await createInvoice(
			invoiceInput(contractRow.id, { issueDate: '1943-08-01' }),
			{ kind: 'human', email: 'lorenzo@example.com' },
			'test fixture',
			tx
		);
		// Collected inside A's own window.
		await recordPayment(underA.id, { amount: underA.total, date: '1943-03-01' }, tx);
		// Issued under A, collected under B: comma 72's case.
		await recordPayment(straddling.id, { amount: straddling.total, date: '1943-09-01' }, tx);
		// Wholly B's.
		await recordPayment(underB.id, { amount: underB.total, date: '1943-09-15' }, tx);

		const packCeiling = (id: string) => ({
			id,
			origin: 'pack' as const,
			label: { en: 'Cap', it: 'Tetto' },
			measure: 'absolute_amount' as const,
			value: minorUnits(10_000_000),
			basis: 'cash_received_calendar_year' as const,
			perimeter: { kind: 'all_clients' as const },
			alertLevels: [],
			consequence: { en: 'x', it: 'x' }
		});
		const base = {
			version: '1',
			effectiveFrom: '1900-01-01',
			displayName: { en: 'x', it: 'x' },
			basis: 'cash' as const,
			fiscalYear: { startMonth: 1, startDay: 1 },
			treatments: [],
			charges: [],
			formats: [],
			unresolvedRevenue: 'carries_forward' as const
		};
		const packA: FiscalPack = { ...base, id: 'test-regime-a', ceilings: [packCeiling('cap-a')] };
		const packB: FiscalPack = { ...base, id: 'test-regime-b', ceilings: [packCeiling('cap-b')] };
		const registry: PackRegistry = buildRegistry([packA, packB]);

		await tx.delete(fiscalProfile);
		await tx.insert(fiscalProfile).values([
			{ packId: 'test-regime-a', packVersion: '1', validFrom: '1943-01-01', validTo: '1943-07-01' },
			{ packId: 'test-regime-b', packVersion: '1', validFrom: '1943-07-01', validTo: '1944-01-01' }
		]);

		// Evaluated inside B's own window, so B's ceiling is the active one.
		const evaluated = await evaluateActiveCeilings('1943-10-01', tx, registry);
		return {
			b: evaluated.find((entry) => entry.ceiling.id === 'cap-b'),
			invoiceTotal: underB.total
		};
	});

	// B recognised the two September payments, both received inside its own
	// window. The 1 March one is A's and stays A's: summing the calendar year
	// under one basis, which is what happened before #336, gave B all three.
	expect(outcome.b).toBeDefined();
	expect(outcome.b?.currentValue).toBe(outcome.invoiceTotal * 2);
	expect(outcome.b?.period).toEqual({ from: '1943-01-01', to: '1944-01-01' });
});
