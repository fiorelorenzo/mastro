import { expect, test } from 'vitest';
import {
	invoiceExcerptRejectionReason,
	parseExtractedInvoice,
	validateInvoice,
	type ExtractedInvoice
} from './invoice-extraction';

const line = (over: Partial<ExtractedInvoice['lines'][number]> = {}) => ({
	description: 'Consulenza marzo 2026',
	quantity: 1,
	unitPrice: '600.00',
	amount: '600.00',
	taxRate: 0,
	...over
});

const invoice = (over: Partial<ExtractedInvoice> = {}): ExtractedInvoice => ({
	number: 'INV-2026-014',
	issueDate: '2026-03-04',
	dueDate: '2026-04-03',
	clientName: 'Acme SRL',
	currency: 'EUR',
	lines: [line()],
	taxableAmount: '600.00',
	taxAmount: '0.00',
	total: '600.00',
	...over
});

test('a well-formed answer parses, including a null due date', () => {
	const parsed = parseExtractedInvoice({
		number: ' INV-2026-014 ',
		issueDate: '2026-03-04',
		dueDate: null,
		clientName: ' Acme SRL ',
		currency: 'EUR',
		lines: [
			{ description: 'Consulenza', quantity: 1, unitPrice: '600.00', amount: '600.00', taxRate: 0 }
		],
		taxableAmount: '600.00',
		taxAmount: '0.00',
		total: '600.00'
	});
	expect(parsed.number).toBe('INV-2026-014');
	expect(parsed.clientName).toBe('Acme SRL');
	expect(parsed.dueDate).toBeNull();
	expect(parsed.lines).toEqual([
		{ description: 'Consulenza', quantity: 1, unitPrice: '600.00', amount: '600.00', taxRate: 0 }
	]);
});

test('a missing number throws naming the field, rather than being repaired', () => {
	expect(() =>
		parseExtractedInvoice({
			issueDate: '2026-03-04',
			dueDate: null,
			clientName: 'Acme SRL',
			currency: 'EUR',
			lines: [line()],
			taxableAmount: '600.00',
			taxAmount: '0.00',
			total: '600.00'
		})
	).toThrow(/proposedFields\.number/);
});

test('an empty lines array throws', () => {
	expect(() => parseExtractedInvoice({ ...invoice(), lines: [] })).toThrow(/lines/);
});

test('a line missing its amount throws naming the line', () => {
	expect(() =>
		parseExtractedInvoice({
			...invoice(),
			lines: [{ description: 'x', quantity: 1, unitPrice: '1.00', taxRate: 0 }]
		})
	).toThrow(/line 0/);
});

test('a well-formed invoice validates, with every amount converted to minor units', () => {
	const result = validateInvoice(invoice());
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error('expected ok');
	expect(result.fields.taxableAmount).toBe(60000);
	expect(result.fields.taxAmount).toBe(0);
	expect(result.fields.total).toBe(60000);
	expect(result.fields.lines).toEqual([
		{
			description: 'Consulenza marzo 2026',
			quantity: 1,
			unitPrice: 60000,
			amount: 60000,
			taxRate: 0
		}
	]);
});

test('a taxableAmount that does not match the sum of its lines is refused', () => {
	const result = validateInvoice(invoice({ taxableAmount: '650.00', total: '650.00' }));
	expect(result.ok).toBe(false);
	if (result.ok) throw new Error('expected refused');
	expect(result.reason).toMatch(/does not match the sum of its lines/);
});

test('a total that does not equal taxableAmount plus taxAmount is refused', () => {
	const result = validateInvoice(invoice({ total: '700.00' }));
	expect(result.ok).toBe(false);
	if (result.ok) throw new Error('expected refused');
	expect(result.reason).toMatch(/does not equal taxableAmount/);
});

test('two lines summing correctly validate, tax included', () => {
	const result = validateInvoice(
		invoice({
			lines: [
				line({ description: 'Consulenza', amount: '500.00', unitPrice: '500.00' }),
				line({ description: 'Spese', amount: '100.00', unitPrice: '100.00', taxRate: 22 })
			],
			taxableAmount: '600.00',
			taxAmount: '22.00',
			total: '622.00'
		})
	);
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error('expected ok');
	expect(result.fields.taxAmount).toBe(2200);
	expect(result.fields.total).toBe(62200);
});

test('an issue date that is not a real date is refused, shape notwithstanding', () => {
	const result = validateInvoice(invoice({ issueDate: '2026-02-30' }));
	expect(result.ok).toBe(false);
	if (result.ok) throw new Error('expected refused');
	expect(result.reason).toMatch(/issueDate/);
});

test('a non-positive line quantity is refused', () => {
	const result = validateInvoice(invoice({ lines: [line({ quantity: 0 })] }));
	expect(result.ok).toBe(false);
	if (result.ok) throw new Error('expected refused');
	expect(result.reason).toMatch(/quantity 0 is not positive/);
});

test('a tax rate out of range is refused', () => {
	const result = validateInvoice(invoice({ lines: [line({ taxRate: 130 })] }));
	expect(result.ok).toBe(false);
	if (result.ok) throw new Error('expected refused');
	expect(result.reason).toMatch(/taxRate 130 is out of range/);
});

test('a garbled amount that does not parse as a decimal is refused', () => {
	const result = validateInvoice(invoice({ total: 'sixhundred' }));
	expect(result.ok).toBe(false);
	if (result.ok) throw new Error('expected refused');
	expect(result.reason).toMatch(/not a decimal amount/);
});

const content = 'Fattura n. INV-2026-014 del 04/03/2026. Cliente: Acme SRL. Totale: 600.00 EUR.';

test('an excerpt verbatim in the document passes', () => {
	expect(
		invoiceExcerptRejectionReason('Fattura n. INV-2026-014 del 04/03/2026', content)
	).toBeNull();
});

test('an excerpt that is not verbatim in the document is refused', () => {
	expect(invoiceExcerptRejectionReason('Invoice number INV-2026-014', content)).toMatch(
		/not verbatim/
	);
});

test('an excerpt too short to read as evidence is refused, even when verbatim', () => {
	expect(invoiceExcerptRejectionReason('INV-2026', content)).toMatch(/too short/);
});

test('an excerpt whose whitespace was reflowed still counts as verbatim', () => {
	expect(
		invoiceExcerptRejectionReason('Fattura n. INV-2026-014\ndel 04/03/2026', content)
	).toBeNull();
});
