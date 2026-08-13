// #217 (the total is computed from the days, never typed) and #216 (the
// tax treatment comes from the pack), both on the invoice creation screen.
// `buildDayLines`/`buildExpenseLines`/`buildManualLine`/`resolveInvoiceTax`
// are pure — no database — so most of this is a plain unit suite; the two
// tests that need a real fiscal profile use `inRolledBackTransaction`, the
// same pattern every other fiscal test in this tree uses.

import { afterAll, describe, expect, test } from 'vitest';
import { client as pool } from '$lib/server/db';
import { fiscalProfile } from '$lib/server/db/schema/fiscal';
import { minorUnits, minorUnitsFromMajor } from '$lib/money';
import { resolveActiveFiscalPack } from '$lib/server/fiscal/profile';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import {
	buildDayLines,
	buildExpenseLines,
	buildManualLine,
	parseInvoiceForm,
	parseManualInvoiceTax,
	resolveInvoiceTax,
	type InvoiceFormValues,
	type PriceableDay
} from './invoice-form';

afterAll(async () => {
	await pool.end();
});

const dailyCard = (id: string, validFrom: string, validTo: string | null, amount: number) => ({
	id,
	validFrom,
	validTo,
	kind: 'daily' as const,
	amount,
	unit: 'day',
	allowedFractions: [1, 0.5],
	minimumHours: null,
	disbursementPeriod: null
});

describe('buildDayLines', () => {
	test("a line's amount always equals its days priced at the rate card in force on each of them", () => {
		const cards = [dailyCard('card-1', '2024-01-01', null, 600)];
		const days: PriceableDay[] = [
			{ id: 'd1', date: '2024-06-10', quantity: 1 },
			{ id: 'd2', date: '2024-06-11', quantity: 0.5 }
		];
		const result = buildDayLines(days, cards, 'EUR');
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.lines).toHaveLength(1);
		const [line] = result.lines;
		// 1 full day (600) + 1 half day (300) = 900, exactly the sum of each
		// day's own priced amount — never a `quantity * unitPrice` guess.
		expect(line.amount).toBe(minorUnits(90000));
		expect(line.quantity).toBe(1.5);
		expect(line.unitPrice).toBe(minorUnitsFromMajor(600, 'EUR'));
		expect(line.workUnitIds.sort()).toEqual(['d1', 'd2']);
	});

	test('a rate change mid-selection splits into two lines, one per card in force, oldest first', () => {
		const cards = [
			dailyCard('card-old', '2024-01-01', '2024-06-30', 600),
			dailyCard('card-new', '2024-07-01', null, 650)
		];
		const days: PriceableDay[] = [
			{ id: 'd1', date: '2024-06-15', quantity: 1 },
			{ id: 'd2', date: '2024-07-05', quantity: 1 }
		];
		const result = buildDayLines(days, cards, 'EUR');
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.lines).toHaveLength(2);
		expect(result.lines[0].amount).toBe(minorUnits(60000));
		expect(result.lines[0].workUnitIds).toEqual(['d1']);
		expect(result.lines[1].amount).toBe(minorUnits(65000));
		expect(result.lines[1].workUnitIds).toEqual(['d2']);
	});

	test('a day with no rate card in force on its own date fails the whole batch, never prices it at zero', () => {
		const cards = [dailyCard('card-1', '2024-06-01', '2024-06-30', 600)];
		const days: PriceableDay[] = [
			{ id: 'd1', date: '2024-06-10', quantity: 1 },
			{ id: 'd2', date: '2024-07-15', quantity: 1 }
		];
		const result = buildDayLines(days, cards, 'EUR');
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.unpricedDayIds).toEqual(['d2']);
	});

	test('a day whose fraction the card in force rejects is also reported unpriced', () => {
		const cards = [{ ...dailyCard('card-1', '2024-01-01', null, 600), allowedFractions: [1] }];
		const days: PriceableDay[] = [{ id: 'd1', date: '2024-06-10', quantity: 0.5 }];
		const result = buildDayLines(days, cards, 'EUR');
		expect(result.ok).toBe(false);
	});

	test('no days produces no lines, not an error', () => {
		const result = buildDayLines([], [], 'EUR');
		expect(result).toEqual({ ok: true, lines: [] });
	});
});

describe('buildExpenseLines and buildManualLine', () => {
	test('each expense becomes its own line, never folded into a day line', () => {
		const lines = buildExpenseLines([
			{ id: 'e1', description: 'Train ticket', amount: minorUnits(4200) },
			{ id: 'e2', description: 'Hotel', amount: minorUnits(15000) }
		]);
		expect(lines).toHaveLength(2);
		expect(lines[0].amount).toBe(minorUnits(4200));
		expect(lines[0].expenseIds).toEqual(['e1']);
		expect(lines[0].workUnitIds).toEqual([]);
	});

	test('the manual line carries neither workUnitIds nor expenseIds — the structural "this one is manual" marker', () => {
		const line = buildManualLine({ description: 'Genuine exception', amount: minorUnits(10000) });
		expect(line.workUnitIds).toEqual([]);
		expect(line.expenseIds).toEqual([]);
		expect(line.amount).toBe(minorUnits(10000));
	});
});

describe('resolveInvoiceTax against both real shipped packs (#216)', () => {
	test('a forfettario invoice resolves VAT-exempt, with the exact statutory citation, nobody typing it', async () => {
		await inRolledBackTransaction(async (tx) => {
			await tx.insert(fiscalProfile).values({
				packId: 'it-flat-rate',
				packVersion: '1',
				validFrom: '2024-01-01',
				validTo: null
			});
			const resolved = await resolveActiveFiscalPack(tx, '2024-06-01');
			const tax = resolveInvoiceTax(resolved?.pack ?? null, minorUnits(100_000));

			expect(tax.source).toBe('pack');
			if (tax.source !== 'pack') return;
			expect(tax.treatmentCode).toBe('N2.2');
			expect(tax.taxRate).toBe(0);
			expect(tax.statutoryReference?.language).toBe('it');
			expect(tax.statutoryReference?.text).toBe(
				"Operazione senza applicazione dell'IVA, ai sensi dell'articolo 1, comma 58, della legge 23 dicembre 2014, n. 190"
			);
		});
	});

	test('the same invoice under the standard pack resolves ordinary, standard-rate VAT, no code, no citation', async () => {
		await inRolledBackTransaction(async (tx) => {
			await tx.insert(fiscalProfile).values({
				packId: 'it-standard',
				packVersion: '1',
				validFrom: '2024-01-01',
				validTo: null
			});
			const resolved = await resolveActiveFiscalPack(tx, '2024-06-01');
			const tax = resolveInvoiceTax(resolved?.pack ?? null, minorUnits(100_000));

			expect(tax.source).toBe('pack');
			if (tax.source !== 'pack') return;
			expect(tax.treatmentCode).toBeNull();
			expect(tax.taxRate).toBe(22);
			expect(tax.statutoryReference).toBeNull();
		});
	});

	test('switching the fiscal profile changes the resolved treatment with no code change', async () => {
		await inRolledBackTransaction(async (tx) => {
			await tx.insert(fiscalProfile).values({
				packId: 'it-flat-rate',
				packVersion: '1',
				validFrom: '2024-01-01',
				validTo: '2025-01-01'
			});
			await tx.insert(fiscalProfile).values({
				packId: 'it-standard',
				packVersion: '1',
				validFrom: '2025-01-01',
				validTo: null
			});

			const before = await resolveActiveFiscalPack(tx, '2024-06-01');
			const after = await resolveActiveFiscalPack(tx, '2025-06-01');

			const beforeTax = resolveInvoiceTax(before?.pack ?? null, minorUnits(100_000));
			const afterTax = resolveInvoiceTax(after?.pack ?? null, minorUnits(100_000));

			expect(beforeTax).toMatchObject({ source: 'pack', treatmentCode: 'N2.2' });
			expect(afterTax).toMatchObject({ source: 'pack', treatmentCode: null });
		});
	});

	test('no active fiscal profile falls back to manual, never guessing a treatment', () => {
		const tax = resolveInvoiceTax(null, minorUnits(100_000));
		expect(tax).toEqual({ source: 'manual' });
	});
});

describe('parseInvoiceForm', () => {
	function formData(fields: Record<string, string | string[]>): FormData {
		const data = new FormData();
		for (const [key, value] of Object.entries(fields)) {
			if (Array.isArray(value)) {
				for (const entry of value) data.append(key, entry);
			} else {
				data.set(key, value);
			}
		}
		return data;
	}

	const baseFields = {
		contractId: 'contract-1',
		number: 'INV-0001',
		issueDate: '2024-06-30',
		documentType: 'invoice',
		currency: 'EUR'
	};

	test('requires at least one day, expense, or manual line', () => {
		const result = parseInvoiceForm(formData(baseFields));
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors.lines).toBeTruthy();
	});

	test('a day selection alone is enough — no amount typed anywhere', () => {
		const result = parseInvoiceForm(formData({ ...baseFields, workUnitIds: ['d1', 'd2'] }));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.core.workUnitIds.sort()).toEqual(['d1', 'd2']);
		expect(result.core.manualLine).toBeNull();
	});

	test('a manual line needs both a description and an amount, symmetrically', () => {
		const descriptionOnly = parseInvoiceForm(
			formData({ ...baseFields, manualLineDescription: 'Exception' })
		);
		expect(descriptionOnly.ok).toBe(false);

		const amountOnly = parseInvoiceForm(formData({ ...baseFields, manualLineAmount: '100.00' }));
		expect(amountOnly.ok).toBe(false);

		const both = parseInvoiceForm(
			formData({ ...baseFields, manualLineDescription: 'Exception', manualLineAmount: '100.00' })
		);
		expect(both.ok).toBe(true);
		if (!both.ok) return;
		expect(both.core.manualLine).toEqual({ description: 'Exception', amount: minorUnits(10000) });
	});

	test('duplicate day ids in the submission are deduplicated, never double-billed', () => {
		const result = parseInvoiceForm(formData({ ...baseFields, workUnitIds: ['d1', 'd1', 'd2'] }));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.core.workUnitIds.sort()).toEqual(['d1', 'd2']);
	});
});

describe('parseManualInvoiceTax (the fallback for an unmodelled pack)', () => {
	const baseValues: InvoiceFormValues = {
		contractId: 'c1',
		number: 'N1',
		issueDate: '2024-06-30',
		documentType: 'invoice',
		currency: 'EUR',
		dueDate: '',
		paymentMethod: '',
		iban: '',
		transmissionId: '',
		workUnitIds: [],
		expenseIds: [],
		manualLineDescription: '',
		manualLineAmount: '',
		taxTreatmentCode: '',
		statutoryReferenceLanguage: '',
		statutoryReferenceText: '',
		taxRate: '22',
		stampDuty: '',
		socialCharge: ''
	};

	test('a valid manual tax rate is accepted', () => {
		const result = parseManualInvoiceTax(baseValues, 'EUR');
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.tax.taxRate).toBe(22);
		expect(result.tax.statutoryReference).toBeNull();
	});

	test('a statutory reference text with no language is rejected', () => {
		const result = parseManualInvoiceTax(
			{ ...baseValues, statutoryReferenceText: 'Some citation' },
			'EUR'
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors.statutoryReferenceLanguage).toBeTruthy();
	});

	test('a tax rate outside 0-100 is rejected', () => {
		const result = parseManualInvoiceTax({ ...baseValues, taxRate: '150' }, 'EUR');
		expect(result.ok).toBe(false);
	});
});
