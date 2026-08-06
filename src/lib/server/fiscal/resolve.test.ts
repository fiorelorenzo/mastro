import { expect, test } from 'vitest';
import type { FiscalPack } from './pack';
import { buildRegistry } from './registry';
import { resolvePackAt, resolvePackOverRange, type FiscalProfilePeriod } from './resolve';

function pack(id: string, version: string): FiscalPack {
	return {
		id,
		version,
		effectiveFrom: '2000-01-01',
		displayName: { en: id, it: id },
		basis: 'accrual',
		fiscalYear: { startMonth: 1, startDay: 1 },
		ceilings: [],
		treatments: [],
		charges: [],
		formats: []
	};
}

const registry = buildRegistry([
	pack('flat-rate', '1'),
	pack('standard', '1'),
	pack('generic', '1')
]);

const regimeChange: readonly FiscalProfilePeriod[] = [
	{ packId: 'flat-rate', packVersion: '1', validFrom: '2023-01-01', validTo: '2025-01-01' },
	{ packId: 'standard', packVersion: '1', validFrom: '2025-01-01', validTo: null }
];

test('resolves the pack in force on a date well inside a profile', () => {
	const resolved = resolvePackAt(registry, regimeChange, '2024-06-15');
	expect(resolved?.pack.id).toBe('flat-rate');
});

test('a date exactly on the regime-change boundary resolves to the new profile, the old one having ended there', () => {
	// valid_to is exclusive, so 2025-01-01 belongs to `standard`, and
	// 2024-12-31 is the last day still under `flat-rate` — the year
	// boundary and the regime change coincide here on purpose, since that
	// is the case that actually happens (switching regime for a new tax
	// year).
	expect(resolvePackAt(registry, regimeChange, '2024-12-31')?.pack.id).toBe('flat-rate');
	expect(resolvePackAt(registry, regimeChange, '2025-01-01')?.pack.id).toBe('standard');
});

test('a profile with no successor still resolves arbitrarily far in the future', () => {
	const openEnded: readonly FiscalProfilePeriod[] = [
		{ packId: 'generic', packVersion: '1', validFrom: '2024-01-01', validTo: null }
	];
	expect(resolvePackAt(registry, openEnded, '2024-01-01')?.pack.id).toBe('generic');
	expect(resolvePackAt(registry, openEnded, '2099-12-31')?.pack.id).toBe('generic');
});

test('a date before any profile started resolves to nothing, not an error', () => {
	expect(resolvePackAt(registry, regimeChange, '2020-01-01')).toBeNull();
});

test('a gap between two profiles resolves to nothing for a date inside the gap', () => {
	const withGap: readonly FiscalProfilePeriod[] = [
		{ packId: 'flat-rate', packVersion: '1', validFrom: '2023-01-01', validTo: '2024-01-01' },
		{ packId: 'standard', packVersion: '1', validFrom: '2024-06-01', validTo: null }
	];
	expect(resolvePackAt(registry, withGap, '2024-03-01')).toBeNull();
});

test('two profiles active on the same date is an error, not an ambiguous pick', () => {
	const overlapping: readonly FiscalProfilePeriod[] = [
		{ packId: 'flat-rate', packVersion: '1', validFrom: '2023-01-01', validTo: '2025-01-01' },
		{ packId: 'standard', packVersion: '1', validFrom: '2024-01-01', validTo: null }
	];
	expect(() => resolvePackAt(registry, overlapping, '2024-06-01')).toThrow(/2 fiscal profiles/);
});

test('a range spanning a regime change resolves one sub-period per pack, clipped to the query', () => {
	const periods = resolvePackOverRange(registry, regimeChange, '2024-06-01', '2025-06-01');
	expect(periods).toHaveLength(2);
	expect(periods[0]).toMatchObject({ from: '2024-06-01', to: '2025-01-01' });
	expect(periods[0].pack.id).toBe('flat-rate');
	expect(periods[1]).toMatchObject({ from: '2025-01-01', to: '2025-06-01' });
	expect(periods[1].pack.id).toBe('standard');
});

test('a range entirely inside one profile resolves a single sub-period', () => {
	const periods = resolvePackOverRange(registry, regimeChange, '2023-03-01', '2023-09-01');
	expect(periods).toEqual([
		expect.objectContaining({
			from: '2023-03-01',
			to: '2023-09-01',
			pack: expect.objectContaining({ id: 'flat-rate' })
		})
	]);
});

test('a range against an open-ended profile clips its end to the query, not to infinity', () => {
	const openEnded: readonly FiscalProfilePeriod[] = [
		{ packId: 'generic', packVersion: '1', validFrom: '2024-01-01', validTo: null }
	];
	const periods = resolvePackOverRange(registry, openEnded, '2024-01-01', '2030-01-01');
	expect(periods).toEqual([expect.objectContaining({ from: '2024-01-01', to: '2030-01-01' })]);
});
