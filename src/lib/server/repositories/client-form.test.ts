import { expect, test } from 'vitest';
import { parseClientForm } from './client-form';

function formData(fields: Record<string, string>): FormData {
	const data = new FormData();
	for (const [key, value] of Object.entries(fields)) data.set(key, value);
	return data;
}

const validBase = {
	legalName: 'Acme Consulting Srl',
	taxId: 'IT12345678901',
	country: 'it',
	addressLine1: 'Via Roma 1',
	addressCity: 'Milano',
	addressPostalCode: '20100',
	noticeChannel: 'email',
	contactCount: '2',
	contactName_0: 'Maria Rossi',
	contactEmail_0: 'maria@acme.example',
	contactCanApprove_0: 'on',
	contactName_1: 'Luca Bianchi',
	contactEmail_1: 'luca@acme.example'
};

test('accepts a valid submission and uppercases the country code', () => {
	const result = parseClientForm(formData(validBase));
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error('expected ok');
	expect(result.input.country).toBe('IT');
	expect(result.input.contacts).toHaveLength(2);
	expect(result.input.contacts[0].canApprove).toBe(true);
	expect(result.input.contacts[1].canApprove).toBe(false);
});

test('drops an untouched spare contact row instead of reporting it', () => {
	const result = parseClientForm(formData({ ...validBase, contactCount: '3' }));
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error('expected ok');
	expect(result.input.contacts).toHaveLength(2);
});

test('rejects a missing legal name', () => {
	const result = parseClientForm(formData({ ...validBase, legalName: '' }));
	expect(result.ok).toBe(false);
	if (result.ok) throw new Error('expected errors');
	expect(result.errors.legalName).toBeDefined();
});

test('rejects a country that is not a two-letter code', () => {
	const result = parseClientForm(formData({ ...validBase, country: 'Italy' }));
	expect(result.ok).toBe(false);
	if (result.ok) throw new Error('expected errors');
	expect(result.errors.country).toBeDefined();
});

test('requires at least one contact', () => {
	const result = parseClientForm(
		formData({ ...validBase, contactCount: '1', contactName_0: '', contactEmail_0: '' })
	);
	expect(result.ok).toBe(false);
	if (result.ok) throw new Error('expected errors');
	expect(result.errors.contacts).toBeDefined();
});

test('reports a contact with a name but no email', () => {
	const result = parseClientForm(
		formData({ ...validBase, contactCount: '1', contactName_0: 'Maria Rossi', contactEmail_0: '' })
	);
	expect(result.ok).toBe(false);
	if (result.ok) throw new Error('expected errors');
	expect(result.errors.contactEmail_0).toBeDefined();
});
