import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { evaluateCharges, fiscalYearOf, type FiscalPack } from './pack';
import { minorUnits } from '$lib/money';
import { buildRegistry } from './registry';
import { resolvePackAt } from './resolve';

// AGENTS.md invariant 1: no country-specific logic outside a pack. `pack.ts`
// and `resolve.ts` are the engine — the interface and the resolver every
// pack, present and future, runs through. `registry.ts` is deliberately
// exempt: it is the one file allowed to name a concrete pack, so that
// adding one is a registration, not an engine change.
const engineFiles = ['./pack.ts', './resolve.ts'];

test('the engine names no concrete pack id, quoted or as a literal', () => {
	for (const file of engineFiles) {
		const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
		// A two-letter-country-code-shaped quoted string, e.g. 'it-flat-rate'.
		expect(source, `${file} should not name a country-shaped pack id`).not.toMatch(
			/['"][a-z]{2}-[a-z-]+['"]/
		);
		// The one pack this issue set actually ships, named directly.
		expect(source, `${file} should not name the generic pack by id`).not.toMatch(/['"]generic['"]/);
	}
});

test('resolution and charge evaluation work on a pack the engine has never seen', () => {
	// A fictitious pack, registered nowhere else in the codebase. If this
	// needs anything beyond the FiscalPack interface to resolve and
	// evaluate correctly, the engine has a hidden special case.
	const imaginary: FiscalPack = {
		id: 'qq-imaginary',
		version: '1',
		effectiveFrom: '2024-01-01',
		displayName: { en: 'Imaginary', it: 'Immaginario' },
		basis: 'cash',
		fiscalYear: { startMonth: 7, startDay: 1 },
		ceilings: [],
		treatments: [],
		formats: ['qq-invoice-v1'],
		charges: [
			{
				id: 'imaginary-duty',
				label: { en: 'Imaginary duty', it: 'Imposta immaginaria' },
				amount: { kind: 'fixed', minorUnits: minorUnits(500) },
				appliesWhen: { fact: 'invoiceTotal', comparator: 'gt', value: 1000 }
			}
		],
		unresolvedRevenue: 'carries_forward'
	};

	const registry = buildRegistry([imaginary]);
	const profiles = [
		{ packId: 'qq-imaginary', packVersion: '1', validFrom: '2024-01-01', validTo: null }
	];

	expect(resolvePackAt(registry, profiles, '2024-08-01')?.pack.id).toBe('qq-imaginary');
	expect(fiscalYearOf(imaginary.fiscalYear, '2024-08-01')).toBe(2024);
	expect(evaluateCharges(imaginary, { invoiceTotal: 2000 })).toEqual([
		{ charge: imaginary.charges[0], amount: 500 }
	]);
});
