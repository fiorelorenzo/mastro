import { expect, test } from 'vitest';
import type { FiscalPack } from './pack';
import { buildRegistry, defaultRegistry, lookupPack } from './registry';

function pack(id: string, version: string): FiscalPack {
	return {
		id,
		version,
		effectiveFrom: '2024-01-01',
		displayName: { en: id, it: id },
		basis: 'accrual',
		fiscalYear: { startMonth: 1, startDay: 1 },
		ceilings: [],
		treatments: [],
		charges: [],
		formats: [],
		unresolvedRevenue: 'carries_forward'
	};
}

test('looks a registered pack up by id and version', () => {
	const registry = buildRegistry([pack('generic', '1'), pack('generic', '2')]);
	expect(lookupPack(registry, 'generic', '1').version).toBe('1');
	expect(lookupPack(registry, 'generic', '2').version).toBe('2');
});

test('refuses to register the same pack id and version twice', () => {
	expect(() => buildRegistry([pack('generic', '1'), pack('generic', '1')])).toThrow(/duplicate/);
});

test('throws on an unregistered pack rather than silently returning nothing', () => {
	const registry = buildRegistry([pack('generic', '1')]);
	expect(() => lookupPack(registry, 'generic', '2')).toThrow(/generic@2/);
});

test('the generic pack ships registered by default', () => {
	const generic = lookupPack(defaultRegistry, 'generic', '1');
	expect(generic.basis).toBe('accrual');
});
