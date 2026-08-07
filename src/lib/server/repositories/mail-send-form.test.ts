import { expect, test } from 'vitest';
import { parseMailSendForm } from './mail-send-form';

function formData(fields: Record<string, string>): FormData {
	const data = new FormData();
	for (const [key, value] of Object.entries(fields)) data.set(key, value);
	return data;
}

const validFields = {
	periodFrom: '2024-03-01',
	periodTo: '2024-03-31',
	invoiceNumber: 'INV-2024-03',
	amount: '1500.00',
	dueDate: '2024-04-30',
	to: 'a@client.example, b@client.example\nc@client.example'
};

test('a fully valid submission parses into minor units and a trimmed recipient list', () => {
	const result = parseMailSendForm(formData(validFields), 'EUR');
	expect(result.ok).toBe(true);
	if (!result.ok) return;
	expect(result.invoice).toEqual({
		number: 'INV-2024-03',
		total: 150000,
		currency: 'EUR',
		dueDate: '2024-04-30'
	});
	expect(result.period).toEqual({ from: '2024-03-01', to: '2024-03-31' });
	expect(result.to).toEqual(['a@client.example', 'b@client.example', 'c@client.example']);
});

test('a period ending before it starts is rejected', () => {
	const result = parseMailSendForm(
		formData({ ...validFields, periodFrom: '2024-03-31', periodTo: '2024-03-01' }),
		'EUR'
	);
	expect(result.ok).toBe(false);
	if (result.ok) return;
	expect(result.errors.period).toBeTruthy();
});

test('an invalid recipient address names itself in the error', () => {
	const result = parseMailSendForm(formData({ ...validFields, to: 'not-an-email' }), 'EUR');
	expect(result.ok).toBe(false);
	if (result.ok) return;
	expect(result.errors.to).toContain('not-an-email');
});

test('a non-decimal amount is rejected', () => {
	const result = parseMailSendForm(formData({ ...validFields, amount: 'lots' }), 'EUR');
	expect(result.ok).toBe(false);
	if (result.ok) return;
	expect(result.errors.amount).toBeTruthy();
});

test('no recipients at all is rejected', () => {
	const result = parseMailSendForm(formData({ ...validFields, to: '' }), 'EUR');
	expect(result.ok).toBe(false);
	if (result.ok) return;
	expect(result.errors.to).toBeTruthy();
});
