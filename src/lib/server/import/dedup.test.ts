import { expect, test } from 'vitest';
import { naturalInvoiceKey } from './dedup';
import type { Invoice, InvoiceParty } from './invoice';

function party(taxId: string): InvoiceParty {
	return {
		legalName: 'Example srl',
		taxId,
		country: 'IT',
		addressLine1: 'Via Roma 1',
		addressCity: 'Milano',
		addressPostalCode: '20100'
	};
}

function invoice(
	overrides: Partial<Pick<Invoice, 'supplier' | 'number' | 'issueDate'>>
): Pick<Invoice, 'supplier' | 'number' | 'issueDate'> {
	return {
		supplier: party('IT01234567890'),
		number: '2024/1',
		issueDate: '2024-03-01',
		...overrides
	};
}

test('the same supplier, number and year produce the same key', () => {
	expect(naturalInvoiceKey(invoice({}))).toBe(naturalInvoiceKey(invoice({})));
});

test('the key ignores case and surrounding whitespace on both the tax id and the number', () => {
	const a = invoice({ supplier: party(' it01234567890 '), number: ' 2024/1 ' });
	const b = invoice({ supplier: party('IT01234567890'), number: '2024/1' });
	expect(naturalInvoiceKey(a)).toBe(naturalInvoiceKey(b));
});

test('a different supplier tax id changes the key', () => {
	const a = invoice({ supplier: party('IT01234567890') });
	const b = invoice({ supplier: party('IT09876543210') });
	expect(naturalInvoiceKey(a)).not.toBe(naturalInvoiceKey(b));
});

test('a different invoice number changes the key', () => {
	expect(naturalInvoiceKey(invoice({ number: '2024/1' }))).not.toBe(
		naturalInvoiceKey(invoice({ number: '2024/2' }))
	);
});

test('a different year changes the key even with the same number', () => {
	expect(naturalInvoiceKey(invoice({ issueDate: '2024-03-01' }))).not.toBe(
		naturalInvoiceKey(invoice({ issueDate: '2025-03-01' }))
	);
});
