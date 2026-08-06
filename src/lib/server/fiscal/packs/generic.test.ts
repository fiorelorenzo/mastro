// The acceptance test for AGENTS.md invariant 1: select `generic` and
// nothing is broken or blank where a ceiling widget would be. There is no
// ceiling widget yet, so this proves what exists: resolution returns the
// pack, and the absence of ceilings, treatments, charges and formats is a
// representable state — an empty array a consumer can render or fold over
// — never a missing field or a thrown error.

import { afterAll, expect, test } from 'vitest';
import { client, db } from '../../db';
import { fiscalProfile } from '../../db/schema/fiscal';
import { evaluateCharges } from '../pack';
import { buildRegistry, lookupPack } from '../registry';
import { resolvePackAt } from '../resolve';
import { resolveActiveFiscalPack } from '../profile';
import { genericPack } from './generic';

afterAll(async () => {
	await client.end();
});

test('the generic pack declares every capability, with the fiscal ones empty', () => {
	expect(genericPack.basis).toBe('accrual');
	expect(genericPack.fiscalYear).toEqual({ startMonth: 1, startDay: 1 });
	expect(genericPack.ceilings).toEqual([]);
	expect(genericPack.treatments).toEqual([]);
	expect(genericPack.charges).toEqual([]);
	expect(genericPack.formats).toEqual([]);
});

test('a consumer reading ceilings off the generic pack gets an empty set, never an error', () => {
	expect(() => genericPack.ceilings.map((c) => c.amount)).not.toThrow();
	expect(genericPack.ceilings.length).toBe(0);
});

test('charge evaluation needs no facts when the pack declares no charges', () => {
	// A pack with charges would throw on a missing fact (pack.test.ts). The
	// generic pack must not: there is nothing to evaluate.
	expect(evaluateCharges(genericPack, {})).toEqual([]);
});

test('resolution finds the generic pack by id and version', () => {
	const registry = buildRegistry([genericPack]);
	expect(lookupPack(registry, 'generic', '1')).toBe(genericPack);

	const profiles = [
		{ packId: 'generic', packVersion: '1', validFrom: '2024-01-01', validTo: null }
	];
	expect(resolvePackAt(registry, profiles, '2024-06-01')?.pack).toBe(genericPack);
});

test('a taxpayer on the generic pack resolves end to end, ceilings included as empty', async () => {
	await expect(
		db.transaction(async (tx) => {
			await tx.insert(fiscalProfile).values({
				packId: 'generic',
				packVersion: '1',
				validFrom: '2024-01-01',
				validTo: null
			});

			const resolved = await resolveActiveFiscalPack(tx, '2024-06-01');
			expect(resolved?.pack.id).toBe('generic');
			expect(resolved?.pack.ceilings).toEqual([]);

			tx.rollback();
		})
	).rejects.toThrow();
});
