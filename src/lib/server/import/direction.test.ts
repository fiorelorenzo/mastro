// #45. These tests build `Invoice` values by hand rather than through any
// adapter: direction detection reads only `supplier.taxId` and a
// configured tax id, and must work identically whichever format produced
// the invoice.
import { expect, test } from 'vitest';
import {
	classifyDirection,
	classifyImportedInvoice,
	revenueEligibleInvoices,
	type ImportedInvoiceOutcome
} from './direction';
import type { Invoice, InvoiceParty } from './invoice';

function party(taxId: string): InvoiceParty {
	return {
		legalName: 'Test Party',
		taxId,
		country: 'IT',
		addressLine1: 'Via Test 1',
		addressCity: 'Milano',
		addressPostalCode: '20100'
	};
}

function invoice(supplierTaxId: string, total = 100000): Invoice {
	return {
		number: '1/2026',
		issueDate: '2026-01-01',
		documentType: 'invoice',
		currency: 'EUR',
		supplier: party(supplierTaxId),
		customer: party('IT99999999999'),
		lines: [],
		taxSummary: [],
		taxableAmount: total,
		taxAmount: 0,
		total,
		socialSecurityCharges: [],
		paymentTerms: [],
		transmission: { transmitterId: 'IT00000000000', progressiveNumber: '1' }
	};
}

test('a matching supplier tax id is outgoing', () => {
	expect(classifyDirection('IT01234567890', 'IT01234567890')).toEqual({ kind: 'outgoing' });
});

test('a different supplier tax id is incoming, with the reason', () => {
	expect(classifyDirection('IT01234567890', 'IT09876543210')).toEqual({
		kind: 'incoming',
		reason: {
			kind: 'supplier_is_not_account_holder',
			supplierTaxId: 'IT01234567890',
			accountHolderTaxId: 'IT09876543210'
		}
	});
});

test('matching ignores case and surrounding whitespace', () => {
	expect(classifyDirection(' it01234567890 ', 'IT01234567890').kind).toBe('outgoing');
});

test('classifyImportedInvoice keeps the invoice on the outgoing branch', () => {
	const outcome = classifyImportedInvoice(invoice('IT01234567890'), 'IT01234567890');
	expect(outcome.kind).toBe('outgoing');
});

test("an invoicing service transmitting on the account holder's behalf is still read from the supplier, never the transmitter", () => {
	// The trap #42/#45 both call out: `transmission.transmitterId` here is
	// deliberately a third party, distinct from both `supplier.taxId` and
	// `accountHolderTaxId`. If direction detection ever looked at
	// `transmission` instead of `supplier`, this would misclassify as
	// incoming.
	const doc = invoice('IT01234567890');
	expect(doc.transmission.transmitterId).not.toBe(doc.supplier.taxId);
	expect(classifyImportedInvoice(doc, 'IT01234567890').kind).toBe('outgoing');
});

test('an incoming invoice is skipped and carries its reason', () => {
	const outcome = classifyImportedInvoice(invoice('IT01234567890'), 'IT09876543210');
	expect(outcome.kind).toBe('incoming_skipped');
	if (outcome.kind !== 'incoming_skipped') throw new Error('unreachable');
	expect(outcome.reason).toEqual({
		kind: 'supplier_is_not_account_holder',
		supplierTaxId: 'IT01234567890',
		accountHolderTaxId: 'IT09876543210'
	});
});

test('revenueEligibleInvoices returns only the outgoing invoices', () => {
	const outcomes: ImportedInvoiceOutcome[] = [
		classifyImportedInvoice(invoice('IT01234567890', 100_000), 'IT01234567890'),
		classifyImportedInvoice(invoice('IT55555555555', 999_999_999), 'IT01234567890'),
		classifyImportedInvoice(invoice('IT01234567890', 50_000), 'IT01234567890')
	];

	const eligible = revenueEligibleInvoices(outcomes);
	expect(eligible.map((inv) => inv.total)).toEqual([100_000, 50_000]);
	// The incoming invoice's huge total never enters the sum, whatever the
	// caller does with `eligible` — it is not in the array at all.
	expect(eligible.reduce((sum, inv) => sum + inv.total, 0)).toBe(150_000);
});

test('an all-incoming batch is revenue-eligible for nothing', () => {
	const outcomes = [classifyImportedInvoice(invoice('IT55555555555'), 'IT01234567890')];
	expect(revenueEligibleInvoices(outcomes)).toEqual([]);
});
