import { expect, test } from 'vitest';
import { buildRegistry } from '$lib/server/fiscal/registry';
import type { FiscalPack } from '$lib/server/fiscal/pack';
import { fiscalPackKey, parseFiscalProfileForm } from './fiscal-profile-form';

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
		formats: [],
		unresolvedRevenue: 'carries_forward'
	};
}

const genericPack = pack('generic', '1');
const flatRatePack = pack('it-flat-rate', '1');
const registry = buildRegistry([genericPack, flatRatePack]);

function formData(fields: Record<string, string>): FormData {
	const data = new FormData();
	for (const [key, value] of Object.entries(fields)) data.set(key, value);
	return data;
}

test('fiscalPackKey round-trips through parseFiscalProfileForm to the exact pack chosen', () => {
	const result = parseFiscalProfileForm(
		formData({ packKey: fiscalPackKey(flatRatePack), validFrom: '2024-01-01', validTo: '' }),
		registry
	);
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error('expected ok');
	expect(result.input.packId).toBe('it-flat-rate');
	expect(result.input.packVersion).toBe('1');
	expect(result.input.validTo).toBeNull();
});

test('an open-ended profile (no validTo) is accepted', () => {
	const result = parseFiscalProfileForm(
		formData({ packKey: fiscalPackKey(genericPack), validFrom: '2024-01-01', validTo: '' }),
		registry
	);
	expect(result.ok).toBe(true);
});

test('rejects a pack key that names no pack in the registry', () => {
	const result = parseFiscalProfileForm(
		formData({ packKey: 'not-a-real-pack@1', validFrom: '2024-01-01', validTo: '' }),
		registry
	);
	expect(result.ok).toBe(false);
	if (result.ok) throw new Error('expected errors');
	expect(result.errors.packKey).toBeDefined();
});

test('rejects a missing validFrom', () => {
	const result = parseFiscalProfileForm(
		formData({ packKey: fiscalPackKey(genericPack), validFrom: '', validTo: '' }),
		registry
	);
	expect(result.ok).toBe(false);
	if (result.ok) throw new Error('expected errors');
	expect(result.errors.validFrom).toBeDefined();
});

test('rejects a validTo on or before validFrom, mirroring the database CHECK', () => {
	const same = parseFiscalProfileForm(
		formData({
			packKey: fiscalPackKey(genericPack),
			validFrom: '2024-01-01',
			validTo: '2024-01-01'
		}),
		registry
	);
	expect(same.ok).toBe(false);
	if (same.ok) throw new Error('expected errors');
	expect(same.errors.validTo).toBeDefined();

	const before = parseFiscalProfileForm(
		formData({
			packKey: fiscalPackKey(genericPack),
			validFrom: '2024-06-01',
			validTo: '2024-01-01'
		}),
		registry
	);
	expect(before.ok).toBe(false);
	if (before.ok) throw new Error('expected errors');
	expect(before.errors.validTo).toBeDefined();
});

test('accepts a bounded historical period', () => {
	const result = parseFiscalProfileForm(
		formData({
			packKey: fiscalPackKey(flatRatePack),
			validFrom: '2023-01-01',
			validTo: '2024-01-01'
		}),
		registry
	);
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error('expected ok');
	expect(result.input.validTo).toBe('2024-01-01');
});
