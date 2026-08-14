import { expect, test } from 'vitest';
import { parsePracticeProfileForm } from './practice-profile-form';

function formData(fields: Record<string, string>): FormData {
	const data = new FormData();
	for (const [key, value] of Object.entries(fields)) data.set(key, value);
	return data;
}

const validBase = {
	legalName: 'Vera Marchetti',
	taxId: 'MRCVRA80A01H501Z',
	vatId: 'IT01234567890',
	country: 'it',
	addressLine1: 'Via Garibaldi 12',
	addressCity: 'Bologna',
	addressPostalCode: '40100'
};

test('accepts a valid submission and uppercases the country code', () => {
	const result = parsePracticeProfileForm(formData(validBase));
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error('expected ok');
	expect(result.input.country).toBe('IT');
	expect(result.input.vatId).toBe('IT01234567890');
});

test('a blank optional VAT id parses to null, never an empty string reaching the row', () => {
	const result = parsePracticeProfileForm(formData({ ...validBase, vatId: '' }));
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error('expected ok');
	expect(result.input.vatId).toBeNull();
});

test('rejects a missing legal name', () => {
	const result = parsePracticeProfileForm(formData({ ...validBase, legalName: '' }));
	expect(result.ok).toBe(false);
	if (result.ok) throw new Error('expected errors');
	expect(result.errors.legalName).toBeDefined();
});

test('rejects a missing tax id', () => {
	const result = parsePracticeProfileForm(formData({ ...validBase, taxId: '' }));
	expect(result.ok).toBe(false);
	if (result.ok) throw new Error('expected errors');
	expect(result.errors.taxId).toBeDefined();
});

test('rejects a country that is not a two-letter code', () => {
	const result = parsePracticeProfileForm(formData({ ...validBase, country: 'Italy' }));
	expect(result.ok).toBe(false);
	if (result.ok) throw new Error('expected errors');
	expect(result.errors.country).toBeDefined();
});

test('rejects a missing address, city and postal code together', () => {
	const result = parsePracticeProfileForm(
		formData({ ...validBase, addressLine1: '', addressCity: '', addressPostalCode: '' })
	);
	expect(result.ok).toBe(false);
	if (result.ok) throw new Error('expected errors');
	expect(result.errors.addressLine1).toBeDefined();
	expect(result.errors.addressCity).toBeDefined();
	expect(result.errors.addressPostalCode).toBeDefined();
});
