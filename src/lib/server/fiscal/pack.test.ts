import { expect, test } from 'vitest';
import {
	evaluateCharges,
	evaluateInvoiceCharges,
	fiscalYearBounds,
	fiscalYearOf,
	resolveDefaultTaxTreatment,
	type FiscalPack
} from './pack';
import { minorUnits } from '$lib/money';

test('a calendar fiscal year is just the calendar year', () => {
	const definition = { startMonth: 1, startDay: 1 };
	expect(fiscalYearOf(definition, '2024-12-31')).toBe(2024);
	expect(fiscalYearOf(definition, '2025-01-01')).toBe(2025);
	expect(fiscalYearBounds(definition, 2024)).toEqual({ start: '2024-01-01', end: '2024-12-31' });
});

test('a non-calendar fiscal year crosses the boundary on its own start date, not January 1st', () => {
	// Nothing in the product ships a non-calendar pack today, but the date
	// math must not assume one: a UK-style year starting 6 April is not a
	// country's rule the engine bakes in, it is a value the definition
	// carries.
	const definition = { startMonth: 4, startDay: 6 };
	expect(fiscalYearOf(definition, '2024-04-05')).toBe(2023);
	expect(fiscalYearOf(definition, '2024-04-06')).toBe(2024);
	expect(fiscalYearOf(definition, '2025-01-01')).toBe(2024);
	expect(fiscalYearBounds(definition, 2024)).toEqual({ start: '2024-04-06', end: '2025-04-05' });
});

const packWithCharges: FiscalPack = {
	id: 'test-pack',
	version: '1',
	effectiveFrom: '2024-01-01',
	displayName: { en: 'Test pack', it: 'Pacchetto di prova' },
	basis: 'accrual',
	fiscalYear: { startMonth: 1, startDay: 1 },
	ceilings: [],
	treatments: [],
	formats: [],
	unresolvedRevenue: 'carries_forward',
	charges: [
		{
			id: 'always-on',
			label: { en: 'Fixed fee', it: 'Quota fissa' },
			amount: { kind: 'fixed', minorUnits: minorUnits(200) },
			slot: 'stamp_duty'
		},
		{
			// Modelled on a stamp duty that only applies once the invoice
			// total crosses a threshold — a condition the engine evaluates,
			// not a callback the pack runs.
			id: 'threshold-stamp',
			label: { en: 'Stamp duty', it: 'Imposta di bollo' },
			amount: { kind: 'fixed', minorUnits: minorUnits(200) },
			appliesWhen: { fact: 'invoiceTotal', comparator: 'gt', value: 7747 },
			slot: 'stamp_duty'
		},
		{
			id: 'surcharge',
			label: { en: 'Social surcharge', it: 'Contributo previdenziale' },
			amount: { kind: 'percentage', basisPoints: 400, of: 'taxableIncome' },
			slot: 'social_charge'
		}
	]
};

test('an unconditional charge always applies', () => {
	const evaluated = evaluateCharges(packWithCharges, { invoiceTotal: 100, taxableIncome: 0 });
	expect(evaluated.map((e) => e.charge.id)).toContain('always-on');
});

test('a conditional charge applies only once the fact crosses its threshold', () => {
	const below = evaluateCharges(packWithCharges, { invoiceTotal: 7000, taxableIncome: 0 });
	expect(below.map((e) => e.charge.id)).not.toContain('threshold-stamp');

	const above = evaluateCharges(packWithCharges, { invoiceTotal: 8000, taxableIncome: 0 });
	const stamp = above.find((e) => e.charge.id === 'threshold-stamp');
	expect(stamp?.amount).toBe(200);
});

test('a percentage charge is computed off the named fact', () => {
	const evaluated = evaluateCharges(packWithCharges, { invoiceTotal: 0, taxableIncome: 10_000 });
	const surcharge = evaluated.find((e) => e.charge.id === 'surcharge');
	expect(surcharge?.amount).toBe(400);
});

test('evaluating a condition against a fact that was not supplied fails loudly', () => {
	expect(() => evaluateCharges(packWithCharges, {})).toThrow(/invoiceTotal/);
});

test('a pack with no charges evaluates to no charges, for any facts', () => {
	const noCharges: FiscalPack = { ...packWithCharges, charges: [] };
	expect(evaluateCharges(noCharges, {})).toEqual([]);
});

test('a pack with no defaultTreatment resolves to no opinion', () => {
	expect(resolveDefaultTaxTreatment(packWithCharges)).toBeNull();
});

test("an 'ordinary' default treatment resolves to no code, no legal text, and its own rate", () => {
	const ordinary: FiscalPack = {
		...packWithCharges,
		defaultTreatment: { kind: 'ordinary', taxRate: 22 }
	};
	expect(resolveDefaultTaxTreatment(ordinary)).toEqual({
		code: null,
		taxRate: 22,
		legalText: null
	});
});

test("a 'treatment' default treatment resolves the named entry's own code, rate and legal text", () => {
	const withTreatment: FiscalPack = {
		...packWithCharges,
		treatments: [
			{
				code: 'X1',
				label: { en: 'Exempt', it: 'Esente' },
				legalText: { kind: 'legal-text', language: 'it', text: 'Esente ai sensi di legge' },
				taxRate: 0
			}
		],
		defaultTreatment: { kind: 'treatment', code: 'X1' }
	};
	expect(resolveDefaultTaxTreatment(withTreatment)).toEqual({
		code: 'X1',
		taxRate: 0,
		legalText: { kind: 'legal-text', language: 'it', text: 'Esente ai sensi di legge' }
	});
});

test('a default treatment naming a code the pack does not declare fails loudly, not silently', () => {
	const broken: FiscalPack = {
		...packWithCharges,
		treatments: [],
		defaultTreatment: { kind: 'treatment', code: 'MISSING' }
	};
	expect(() => resolveDefaultTaxTreatment(broken)).toThrow(/MISSING/);
});

test('evaluateInvoiceCharges sums each slot independently and reports an empty slot as null', () => {
	const result = evaluateInvoiceCharges(packWithCharges, {
		invoiceTotal: 8000,
		taxableIncome: 10_000
	});
	// 'always-on' and 'threshold-stamp' both fill 'stamp_duty': 200 + 200.
	expect(result.stampDuty).toBe(400);
	expect(result.socialCharge).toBe(400);
});

test('evaluateInvoiceCharges reports a slot no evaluated charge fills as null, not zero', () => {
	const noSurcharge: FiscalPack = { ...packWithCharges, charges: [packWithCharges.charges[1]] };
	const result = evaluateInvoiceCharges(noSurcharge, { invoiceTotal: 8000 });
	expect(result.stampDuty).toBe(200);
	expect(result.socialCharge).toBeNull();
});
