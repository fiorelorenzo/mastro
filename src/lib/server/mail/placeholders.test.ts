import { expect, test } from 'vitest';
import { findUnknownPlaceholders, substitutePlaceholders } from './placeholders';

test('every known placeholder passes validation', () => {
	const subject = 'Invoice {{invoice_number}} for {{period}}';
	const body = 'Amount due: {{amount}} by {{due_date}}. Days worked: {{day_list}} ({{day_total}}).';
	expect(findUnknownPlaceholders(subject, body)).toEqual([]);
});

test('an unknown placeholder in the subject is reported', () => {
	expect(findUnknownPlaceholders('Re: {{client_name}}', 'body')).toEqual(['client_name']);
});

test('an unknown placeholder in the body is reported', () => {
	expect(
		findUnknownPlaceholders('subject', 'Hello {{recipient}}, see {{invoice_number}}.')
	).toEqual(['recipient']);
});

test('the same unknown placeholder used twice is reported once', () => {
	expect(findUnknownPlaceholders('{{oops}} and {{oops}} again', 'body')).toEqual(['oops']);
});

test('substitutes every occurrence of a known placeholder', () => {
	const rendered = substitutePlaceholders('{{invoice_number}} / {{invoice_number}}', {
		invoice_number: 'INV-1',
		period: '',
		amount: '',
		due_date: '',
		day_list: '',
		day_total: ''
	});
	expect(rendered).toBe('INV-1 / INV-1');
});

test('throws rather than leaving a raw token when no value was supplied', () => {
	expect(() =>
		substitutePlaceholders(
			'{{invoice_number}}',
			{} as unknown as Record<
				'invoice_number' | 'period' | 'amount' | 'due_date' | 'day_list' | 'day_total',
				string
			>
		)
	).toThrow(/invoice_number/);
});
