import { expect, test } from 'vitest';
import { evaluateCharges, fiscalYearBounds, fiscalYearOf, type FiscalPack } from './pack';

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
			amount: { kind: 'fixed', minorUnits: 200 }
		},
		{
			// Modelled on a stamp duty that only applies once the invoice
			// total crosses a threshold — a condition the engine evaluates,
			// not a callback the pack runs.
			id: 'threshold-stamp',
			label: { en: 'Stamp duty', it: 'Imposta di bollo' },
			amount: { kind: 'fixed', minorUnits: 200 },
			appliesWhen: { fact: 'invoiceTotal', comparator: 'gt', value: 7747 }
		},
		{
			id: 'surcharge',
			label: { en: 'Social surcharge', it: 'Contributo previdenziale' },
			amount: { kind: 'percentage', rate: 0.04, of: 'taxableIncome' }
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
