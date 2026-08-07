import { expect, test } from 'vitest';
import { parseExpenseForm } from './expense-form';

function formData(fields: Record<string, string>): FormData {
	const data = new FormData();
	for (const [key, value] of Object.entries(fields)) data.set(key, value);
	return data;
}

const validBase = {
	date: '2024-02-01',
	description: 'Taxi to client site',
	amount: '50.00'
};

test('accepts a valid unauthorised submission and converts the amount to minor units', () => {
	const result = parseExpenseForm(formData(validBase));
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error('expected ok');
	expect(result.input.amount).toBe(5000);
	expect(result.input.preAuthorised).toBe(false);
	expect(result.input.authorisationReference).toBeNull();
});

test('accepts a pre-authorised submission with a reference', () => {
	const data = formData(validBase);
	data.set('preAuthorised', 'on');
	data.set('authorisationReference', 'client email, 2024-01-20');
	const result = parseExpenseForm(data);
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error('expected ok');
	expect(result.input.preAuthorised).toBe(true);
	expect(result.input.authorisationReference).toBe('client email, 2024-01-20');
});

test('rejects pre-authorised checked with no reference', () => {
	const data = formData(validBase);
	data.set('preAuthorised', 'on');
	const result = parseExpenseForm(data);
	expect(result.ok).toBe(false);
	if (result.ok) throw new Error('expected errors');
	expect(result.errors.authorisationReference).toBeDefined();
});

test('drops a stray authorisation reference when pre-authorised is not checked', () => {
	const data = formData(validBase);
	data.set('authorisationReference', 'stale');
	const result = parseExpenseForm(data);
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error('expected ok');
	expect(result.input.authorisationReference).toBeNull();
});

test('rejects a non-positive amount', () => {
	const result = parseExpenseForm(formData({ ...validBase, amount: '0' }));
	expect(result.ok).toBe(false);
	if (result.ok) throw new Error('expected errors');
	expect(result.errors.amount).toBeDefined();
});

test('rejects a missing description', () => {
	const result = parseExpenseForm(formData({ ...validBase, description: '' }));
	expect(result.ok).toBe(false);
	if (result.ok) throw new Error('expected errors');
	expect(result.errors.description).toBeDefined();
});
