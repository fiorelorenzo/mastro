import { expect, test } from 'vitest';
import { minorUnits, NO_MINOR_UNITS } from '$lib/money';
import {
	ceilingFromContractRow,
	ceilingPeriod,
	evaluateCeiling,
	type ContractCeilingRow
} from './ceiling';
import type { LedgerRow } from './ledger';
import type { Ceiling, FiscalPack } from './pack';
import { buildRegistry } from './registry';
import { resolvePackAt } from './resolve';

const rows: LedgerRow[] = [
	{
		invoiceId: 'a',
		contractId: 'c1',
		clientId: 'client-a',
		issueDate: '2024-05-01',
		paidOn: '2024-05-10',
		amount: minorUnits(60_000)
	},
	{
		invoiceId: 'b',
		contractId: 'c1',
		clientId: 'client-a',
		issueDate: '2024-08-01',
		paidOn: '2024-08-15',
		amount: minorUnits(25_000)
	},
	{
		invoiceId: 'c',
		contractId: 'c2',
		clientId: 'client-b',
		issueDate: '2024-09-01',
		paidOn: '2024-09-20',
		amount: minorUnits(40_000)
	}
];

const packCeiling: Ceiling = {
	id: 'test-pack-revenue-ceiling',
	origin: 'pack',
	label: { en: 'Revenue ceiling', it: 'Soglia di ricavi' },
	measure: 'absolute_amount',
	value: minorUnits(100_000),
	basis: 'cash_received_calendar_year',
	perimeter: { kind: 'all_clients' },
	alertLevels: [
		{ ratio: 0.8, label: { en: 'Approaching', it: 'In avvicinamento' } },
		{ ratio: 1, label: { en: 'Reached', it: 'Raggiunta' } }
	],
	consequence: { en: 'Loses the regime.', it: 'Perde il regime.' }
};

test('an absolute-amount pack ceiling sums cash received across all clients over the calendar year', () => {
	const evaluated = evaluateCeiling(packCeiling, rows, '2024-10-01');
	expect(evaluated.period).toEqual({ from: '2024-01-01', to: '2025-01-01' });
	expect(evaluated.currentValue).toBe(60_000 + 25_000 + 40_000);
	expect(evaluated.limitValue).toBe(100_000);
	expect(evaluated.usageRatio).toBeCloseTo(1.25);
	expect(evaluated.crossed).toBe(true);
	expect(evaluated.activeAlertLevels.map((l) => l.ratio)).toEqual([0.8, 1]);
});

test('below the ceiling, no alert level is active and it has not crossed', () => {
	const smallCeiling: Ceiling = { ...packCeiling, value: minorUnits(1_000_000) };
	const evaluated = evaluateCeiling(smallCeiling, rows, '2024-10-01');
	expect(evaluated.crossed).toBe(false);
	expect(evaluated.activeAlertLevels).toEqual([]);
});

test('an absolute-amount ceiling of exactly zero is crossed the moment any revenue exists against it', () => {
	const zeroCeiling: Ceiling = { ...packCeiling, value: NO_MINOR_UNITS };
	const evaluated = evaluateCeiling(zeroCeiling, rows, '2024-10-01');
	expect(evaluated.limitValue).toBe(0);
	expect(evaluated.currentValue).toBe(125_000);
	expect(evaluated.crossed).toBe(true);
});

test('an absolute-amount ceiling of exactly zero is not crossed with no revenue against it either', () => {
	const zeroCeiling: Ceiling = { ...packCeiling, value: NO_MINOR_UNITS };
	const evaluated = evaluateCeiling(zeroCeiling, [], '2024-10-01');
	expect(evaluated.limitValue).toBe(0);
	expect(evaluated.currentValue).toBe(0);
	expect(evaluated.crossed).toBe(false);
});

test("a percentage-share ceiling scoped to one client computes that client's share of the correct total", () => {
	const shareCeiling: Ceiling = {
		id: 'client-a-share-cap',
		origin: 'contract',
		label: { en: 'Client A share cap', it: 'Tetto quota cliente A' },
		measure: 'percentage_share',
		value: 0.5,
		basis: 'cash_received_calendar_year',
		perimeter: { kind: 'client', clientId: 'client-a' },
		alertLevels: [],
		consequence: { en: 'Renegotiate.', it: 'Rinegoziare.' }
	};

	const evaluated = evaluateCeiling(shareCeiling, rows, '2024-10-01');
	const total = 60_000 + 25_000 + 40_000;
	const clientATotal = 60_000 + 25_000;

	expect(evaluated.currentValue).toBe(clientATotal);
	expect(evaluated.limitValue).toBe(Math.round(total * 0.5));
	expect(evaluated.crossed).toBe(true); // 85,000 >= 62,500
});

test('a percentage-share ceiling responds to the total changing, not just its own client', () => {
	const shareCeiling: Ceiling = {
		id: 'client-a-share-cap',
		origin: 'contract',
		label: { en: 'x', it: 'x' },
		measure: 'percentage_share',
		value: 0.5,
		basis: 'cash_received_calendar_year',
		perimeter: { kind: 'client', clientId: 'client-a' },
		alertLevels: [],
		consequence: { en: 'x', it: 'x' }
	};
	// Client A's own revenue is unchanged, but a much larger total from
	// other clients pulls their share, and so the crossing verdict, down.
	const rowsWithLargerTotal: LedgerRow[] = [
		...rows,
		{
			invoiceId: 'd',
			contractId: 'c3',
			clientId: 'client-c',
			issueDate: '2024-09-01',
			paidOn: '2024-09-20',
			amount: minorUnits(500_000)
		}
	];
	const evaluated = evaluateCeiling(shareCeiling, rowsWithLargerTotal, '2024-10-01');
	expect(evaluated.currentValue).toBe(85_000);
	expect(evaluated.crossed).toBe(false); // 85,000 < 50% of 625,000
});

test('a pack ceiling and a contract ceiling are evaluated by the exact same function', () => {
	const contractCeiling: Ceiling = {
		...packCeiling,
		id: 'contract-cap',
		origin: 'contract',
		perimeter: { kind: 'client', clientId: 'client-a' }
	};

	const packResult = evaluateCeiling(packCeiling, rows, '2024-10-01');
	const contractResult = evaluateCeiling(contractCeiling, rows, '2024-10-01');

	// Same evaluator, same shape of result, different perimeter honoured.
	expect(Object.keys(packResult).sort()).toEqual(Object.keys(contractResult).sort());
	expect(packResult.currentValue).toBe(125_000);
	expect(contractResult.currentValue).toBe(85_000); // scoped to client-a only
});

test('a contract ceiling normalised from a database row evaluates identically to a hand-built one', () => {
	const row: ContractCeilingRow = {
		code: 'client-a-share-cap',
		label: { en: 'Client A share cap', it: 'Tetto quota cliente A' },
		legalBasis: null,
		measure: 'percentage_share',
		absoluteValueMinorUnits: null,
		shareRatio: 0.5,
		basis: 'cash_received_calendar_year',
		alertLevels: [],
		consequence: { en: 'Renegotiate.', it: 'Rinegoziare.' }
	};
	const ceiling = ceilingFromContractRow(row, 'client-a');

	expect(ceiling.origin).toBe('contract');
	expect(ceiling.perimeter).toEqual({ kind: 'client', clientId: 'client-a' });

	const evaluated = evaluateCeiling(ceiling, rows, '2024-10-01');
	expect(evaluated.currentValue).toBe(85_000);
	expect(evaluated.limitValue).toBe(Math.round(125_000 * 0.5));
});

test("a contract-year basis anchors the reset to the contract's own start date, not January 1st", () => {
	const period = ceilingPeriod('cash_received_contract_year', '2024-10-01', '2024-04-15');
	expect(period).toEqual({ from: '2024-04-15', to: '2025-04-15' });
});

test('a contract-year ceiling with no contract anchor fails loudly rather than guessing a year', () => {
	expect(() => ceilingPeriod('cash_received_contract_year', '2024-10-01')).toThrow(/contract/);
});

test('changing the fiscal profile changes which pack ceilings apply, with no code change', () => {
	const packWithCeiling: FiscalPack = {
		id: 'test-flat',
		version: '1',
		effectiveFrom: '2024-01-01',
		displayName: { en: 'Test flat', it: 'Test flat' },
		basis: 'cash',
		fiscalYear: { startMonth: 1, startDay: 1 },
		ceilings: [packCeiling],
		treatments: [],
		charges: [],
		formats: [],
		unresolvedRevenue: 'carries_forward'
	};
	const packWithoutCeiling: FiscalPack = { ...packWithCeiling, id: 'test-standard', ceilings: [] };
	const registry = buildRegistry([packWithCeiling, packWithoutCeiling]);
	const profiles = [
		{ packId: 'test-flat', packVersion: '1', validFrom: '2024-01-01', validTo: '2024-07-01' },
		{ packId: 'test-standard', packVersion: '1', validFrom: '2024-07-01', validTo: null }
	];

	const underFlat = resolvePackAt(registry, profiles, '2024-03-01');
	const underStandard = resolvePackAt(registry, profiles, '2024-09-01');

	// Same evaluation call either side of the switch — nothing here
	// branches on which pack is active. The ceiling set evaluated comes
	// entirely from `pack.ceilings`.
	const flatResults = (underFlat?.pack.ceilings ?? []).map((c) =>
		evaluateCeiling(c, rows, '2024-03-01')
	);
	const standardResults = (underStandard?.pack.ceilings ?? []).map((c) =>
		evaluateCeiling(c, rows, '2024-09-01')
	);

	expect(flatResults).toHaveLength(1);
	expect(standardResults).toHaveLength(0);
});
