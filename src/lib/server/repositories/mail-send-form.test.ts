import { expect, test } from 'vitest';
import { parseMailSendForm } from './mail-send-form';

function formData(fields: Record<string, string>): FormData {
	const data = new FormData();
	for (const [key, value] of Object.entries(fields)) data.set(key, value);
	return data;
}

const invoices = [{ id: 'invoice-1' }, { id: 'invoice-2' }];

const validFields = {
	invoiceId: 'invoice-1',
	to: 'a@client.example, b@client.example\nc@client.example'
};

test('a fully valid submission parses the picked invoice id and a trimmed recipient list', () => {
	const result = parseMailSendForm(formData(validFields), invoices);
	expect(result.ok).toBe(true);
	if (!result.ok) return;
	expect(result.invoiceId).toBe('invoice-1');
	expect(result.to).toEqual(['a@client.example', 'b@client.example', 'c@client.example']);
});

test('an invoice id not among the contract\u2019s own invoices is rejected', () => {
	const result = parseMailSendForm(
		formData({ ...validFields, invoiceId: 'some-other-contract-invoice' }),
		invoices
	);
	expect(result.ok).toBe(false);
	if (result.ok) return;
	expect(result.errors.invoiceId).toBeTruthy();
});

test('no invoice chosen at all is rejected', () => {
	const result = parseMailSendForm(formData({ ...validFields, invoiceId: '' }), invoices);
	expect(result.ok).toBe(false);
	if (result.ok) return;
	expect(result.errors.invoiceId).toBeTruthy();
});

test('an invalid recipient address names itself in the error', () => {
	const result = parseMailSendForm(formData({ ...validFields, to: 'not-an-email' }), invoices);
	expect(result.ok).toBe(false);
	if (result.ok) return;
	expect(result.errors.to).toContain('not-an-email');
});

test('no recipients at all is rejected', () => {
	const result = parseMailSendForm(formData({ ...validFields, to: '' }), invoices);
	expect(result.ok).toBe(false);
	if (result.ok) return;
	expect(result.errors.to).toBeTruthy();
});
