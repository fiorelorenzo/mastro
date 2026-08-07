// #47, extended by #44 and #48. `buildReview` is pure, so it is tested the
// same way `importer.ts` is (see importer.test.ts): a throwaway adapter
// registered under a format id that exists nowhere else, detecting
// invoices by an in-memory marker instead of a real document format.
import { expect, test } from 'vitest';
import { hashContent } from '$lib/server/documents/blob-store';
import type { ImportableFile, InvoiceFormatAdapter } from './adapter';
import type { ClientMatchCandidate } from './client-match';
import type { DayMappingContext } from './review';
import type { ExistingInvoiceRecord } from './dedup';
import { buildAdapterRegistry } from './registry';
import { buildReview } from './review';
import type { Invoice, InvoiceLine, InvoiceParty } from './invoice';

const ACCOUNT_HOLDER_TAX_ID = 'IT11111111111';

function party(overrides: Partial<InvoiceParty> = {}): InvoiceParty {
	return {
		legalName: 'Rossi Consulting srl',
		taxId: 'IT01234567890',
		country: 'IT',
		addressLine1: 'Via Roma 1',
		addressCity: 'Milano',
		addressPostalCode: '20100',
		...overrides
	};
}

function line(overrides: Partial<InvoiceLine> = {}): InvoiceLine {
	return {
		description: 'Consulting',
		quantity: 1,
		unitPrice: 100000,
		amount: 100000,
		taxRate: 0,
		...overrides
	};
}

function invoice(overrides: Partial<Invoice> = {}): Invoice {
	return {
		number: '1',
		issueDate: '2024-01-15',
		documentType: 'invoice',
		currency: 'EUR',
		supplier: party({ taxId: ACCOUNT_HOLDER_TAX_ID, legalName: 'Consultant' }),
		customer: party(),
		lines: [],
		taxSummary: [],
		taxableAmount: 0,
		taxAmount: 0,
		total: 100000,
		socialSecurityCharges: [],
		paymentTerms: [],
		transmission: { transmitterId: ACCOUNT_HOLDER_TAX_ID, progressiveNumber: '1' },
		...overrides
	};
}

function client(overrides: Partial<ClientMatchCandidate> = {}): ClientMatchCandidate {
	return {
		id: 'client-1',
		taxId: 'IT01234567890',
		legalName: 'Rossi Consulting srl',
		activeContractId: 'contract-1',
		...overrides
	};
}

/** Encodes an `Invoice` as JSON in the file's own bytes, and an adapter
 * that decodes it back — a throwaway "format" whose only job is to hand
 * `buildReview` exactly the invoice a test wants, without a real XML
 * document. `malformed.json` is a magic filename this adapter claims via
 * `detect` but always fails to `parse`, exercising the malformed-document
 * path (see adapter.ts: `parse` may throw on a document that passed
 * `detect`). A file whose name ends `.pdf` is never claimed, exercising
 * the unrecognised/companion-attachment path without a real PDF parser. */
const fakeAdapter: InvoiceFormatAdapter = {
	id: 'test-json-invoice',
	detect: (file) => file.filename.endsWith('.json'),
	parse: (file) => {
		if (file.filename === 'malformed.json') throw new Error('missing required element');
		return JSON.parse(new TextDecoder().decode(file.content)) as Invoice;
	}
};

const registry = buildAdapterRegistry([fakeAdapter]);
const pack = { formats: [fakeAdapter.id] };

function jsonFile(filename: string, value: Invoice): ImportableFile {
	return { filename, content: new TextEncoder().encode(JSON.stringify(value)) };
}

function pdfFile(filename: string, content = 'pdf bytes'): ImportableFile {
	return { filename, content: new TextEncoder().encode(content) };
}

test('a file no adapter claims is skipped as unrecognised_format', () => {
	const result = buildReview(
		[{ filename: 'notes.txt', content: new TextEncoder().encode('hello') }],
		pack,
		registry,
		ACCOUNT_HOLDER_TAX_ID,
		[]
	);
	expect(result.skipped).toEqual([
		{ filename: 'notes.txt', reason: { kind: 'unrecognised_format' } }
	]);
});

test('a document that passes detect but fails to parse is skipped as malformed_document, not thrown', () => {
	const result = buildReview(
		[{ filename: 'malformed.json', content: new TextEncoder().encode('{}') }],
		pack,
		registry,
		ACCOUNT_HOLDER_TAX_ID,
		[]
	);
	expect(result.skipped).toEqual([
		{
			filename: 'malformed.json',
			reason: { kind: 'malformed_document', message: 'missing required element' }
		}
	]);
});

test('an incoming invoice (supplier is not the account holder) is skipped with the direction reason', () => {
	const incoming = invoice({ supplier: party({ taxId: 'IT99999999999' }) });
	const result = buildReview(
		[jsonFile('supplier-invoice.json', incoming)],
		pack,
		registry,
		ACCOUNT_HOLDER_TAX_ID,
		[]
	);
	expect(result.skipped).toEqual([
		{
			filename: 'supplier-invoice.json',
			reason: {
				kind: 'incoming_invoice',
				reason: {
					kind: 'supplier_is_not_account_holder',
					supplierTaxId: 'IT99999999999',
					accountHolderTaxId: ACCOUNT_HOLDER_TAX_ID
				}
			}
		}
	]);
	expect(result.recognised).toEqual([]);
	expect(result.clarifications).toEqual([]);
});

test('a known customer with one active contract is recognised silently, no clarification', () => {
	const result = buildReview(
		[jsonFile('a.json', invoice())],
		pack,
		registry,
		ACCOUNT_HOLDER_TAX_ID,
		[client()]
	);
	expect(result.recognised).toEqual([
		{
			filename: 'a.json',
			clientId: 'client-1',
			clientLegalName: 'Rossi Consulting srl',
			contractId: 'contract-1',
			attachments: [],
			lines: [],
			invoice: {
				number: '1',
				issueDate: '2024-01-15',
				customerLegalName: 'Rossi Consulting srl',
				customerTaxId: 'IT01234567890',
				total: 100000,
				currency: 'EUR'
			}
		}
	]);
	expect(result.clarifications).toEqual([]);
});

test('a known customer with no resolvable active contract is skipped as ambiguous_contract, never guessed', () => {
	const result = buildReview(
		[jsonFile('a.json', invoice())],
		pack,
		registry,
		ACCOUNT_HOLDER_TAX_ID,
		[client({ activeContractId: null })]
	);
	expect(result.recognised).toEqual([]);
	expect(result.skipped).toEqual([
		{
			filename: 'a.json',
			reason: { kind: 'ambiguous_contract', clientLegalName: 'Rossi Consulting srl' }
		}
	]);
});

test('an unknown customer produces one clarification, not a skip', () => {
	const result = buildReview(
		[jsonFile('a.json', invoice())],
		pack,
		registry,
		ACCOUNT_HOLDER_TAX_ID,
		[]
	);
	expect(result.recognised).toEqual([]);
	expect(result.skipped).toEqual([]);
	expect(result.clarifications).toHaveLength(1);
	expect(result.clarifications[0].groupKey).toBe('IT01234567890');
	expect(result.clarifications[0].files.map((f) => f.filename)).toEqual(['a.json']);
	expect(result.clarifications[0].client.legalName).toBe('Rossi Consulting srl');
});

test('two invoices for the same unknown customer collapse into one clarification', () => {
	const first = invoice({ number: '1', issueDate: '2024-01-15' });
	const second = invoice({ number: '2', issueDate: '2024-02-15' });
	const result = buildReview(
		[jsonFile('a.json', first), jsonFile('b.json', second)],
		pack,
		registry,
		ACCOUNT_HOLDER_TAX_ID,
		[]
	);
	expect(result.clarifications).toHaveLength(1);
	expect(result.clarifications[0].files.map((f) => f.filename).toSorted()).toEqual([
		'a.json',
		'b.json'
	]);
});

test('two different unknown customers produce two separate clarifications', () => {
	const first = invoice({ number: '1', customer: party({ taxId: 'IT01234567890' }) });
	const second = invoice({
		number: '2',
		customer: party({ taxId: 'IT09876543210', legalName: 'Bianchi spa' })
	});
	const result = buildReview(
		[jsonFile('a.json', first), jsonFile('b.json', second)],
		pack,
		registry,
		ACCOUNT_HOLDER_TAX_ID,
		[]
	);
	expect(result.clarifications).toHaveLength(2);
});

test('a repeated natural key within the batch is already_present (source batch), not recognised twice', () => {
	const original = invoice({ number: '1', issueDate: '2024-01-15' });
	const duplicate = invoice({ number: '1', issueDate: '2024-01-15' });
	const result = buildReview(
		[jsonFile('a.json', original), jsonFile('a-copy.json', duplicate)],
		pack,
		registry,
		ACCOUNT_HOLDER_TAX_ID,
		[client()]
	);
	expect(result.recognised.map((f) => f.filename)).toEqual(['a.json']);
	expect(result.alreadyPresent).toEqual([
		{
			filename: 'a-copy.json',
			source: 'batch',
			duplicateOfFilename: 'a.json',
			existingInvoiceNumber: null,
			attachments: [],
			invoice: expect.objectContaining({ number: '1' })
		}
	]);
	expect(result.conflicts).toEqual([]);
});

test('a duplicate of an unresolved (clarification) invoice is still already_present, not a second clarification', () => {
	const original = invoice({ number: '1', issueDate: '2024-01-15' });
	const duplicate = invoice({ number: '1', issueDate: '2024-01-15' });
	const result = buildReview(
		[jsonFile('a.json', original), jsonFile('a-copy.json', duplicate)],
		pack,
		registry,
		ACCOUNT_HOLDER_TAX_ID,
		[]
	);
	expect(result.clarifications).toHaveLength(1);
	expect(result.clarifications[0].files.map((f) => f.filename)).toEqual(['a.json']);
	expect(result.alreadyPresent.map((f) => f.filename)).toEqual(['a-copy.json']);
});

test('a file matching an invoice already imported in the past is already_present, source database, and nothing new is proposed', () => {
	const existing: ExistingInvoiceRecord[] = [
		{ id: 'inv-1', number: '1', issueDate: '2024-01-15', hashes: [] }
	];
	const file = jsonFile('a.json', invoice({ number: '1', issueDate: '2024-01-15' }));
	existing[0] = { ...existing[0], hashes: [hashContent(file.content)] };
	const result = buildReview([file], pack, registry, ACCOUNT_HOLDER_TAX_ID, [client()], existing);
	expect(result.recognised).toEqual([]);
	expect(result.alreadyPresent).toEqual([
		{
			filename: 'a.json',
			source: 'database',
			duplicateOfFilename: null,
			existingInvoiceNumber: '1',
			attachments: [],
			invoice: expect.objectContaining({ number: '1' })
		}
	]);
});

test('the same natural key with different content is a conflict, never merged or recognised', () => {
	const existing: ExistingInvoiceRecord[] = [
		{ id: 'inv-1', number: '1', issueDate: '2024-01-15', hashes: ['deadbeef'] }
	];
	const file = jsonFile('a.json', invoice({ number: '1', issueDate: '2024-01-15', total: 999999 }));
	const result = buildReview([file], pack, registry, ACCOUNT_HOLDER_TAX_ID, [client()], existing);
	expect(result.recognised).toEqual([]);
	expect(result.alreadyPresent).toEqual([]);
	expect(result.conflicts).toEqual([
		{
			filename: 'a.json',
			existingInvoiceNumber: '1',
			existingIssueDate: '2024-01-15',
			invoice: expect.objectContaining({ number: '1' })
		}
	]);
});

test('a structured document and an unrecognised file sharing its base name attach as one recognised invoice with two attachments', () => {
	const structured = jsonFile('2024/invoice-1.json', invoice());
	const companion = pdfFile('2024/invoice-1.pdf');
	const result = buildReview([structured, companion], pack, registry, ACCOUNT_HOLDER_TAX_ID, [
		client()
	]);
	expect(result.skipped).toEqual([]);
	expect(result.recognised).toHaveLength(1);
	expect(result.recognised[0].attachments).toEqual(['2024/invoice-1.pdf']);
});

test('an unrecognised file with no matching base name in the batch stays a plain skip', () => {
	const structured = jsonFile('invoice-1.json', invoice());
	const unrelated = pdfFile('unrelated.pdf');
	const result = buildReview([structured, unrelated], pack, registry, ACCOUNT_HOLDER_TAX_ID, [
		client()
	]);
	expect(result.skipped).toEqual([
		{ filename: 'unrelated.pdf', reason: { kind: 'unrecognised_format' } }
	]);
	expect(result.recognised[0].attachments).toEqual([]);
});

test('a line on a day-rate contract carries a day-mapping proposal, an hourly line does not', () => {
	const dailyRateCard = {
		id: 'card-1',
		validFrom: '2024-01-01',
		validTo: null,
		kind: 'daily' as const,
		amount: 600,
		unit: 'day',
		allowedFractions: [1],
		minimumHours: null,
		disbursementPeriod: null
	};
	const context: DayMappingContext = {
		rateCards: [dailyRateCard],
		eligibleDays: [{ id: 'wu-1', date: '2024-01-10', quantity: 1 }]
	};
	const withLine = invoice({
		lines: [line({ quantity: 1, amount: 60000 })],
		total: 60000
	});
	const result = buildReview(
		[jsonFile('a.json', withLine)],
		pack,
		registry,
		ACCOUNT_HOLDER_TAX_ID,
		[client()],
		[],
		new Map([['contract-1', context]])
	);
	expect(result.recognised[0].lines[0].dayMapping).toEqual({
		workUnitIds: ['wu-1'],
		periodStart: '2024-01-10',
		periodEnd: '2024-01-10',
		dayCount: 1,
		proposedAmount: 60000,
		lineAmount: 60000,
		amountMatches: true
	});
});

test('a mixed folder sorts every file into exactly one bucket', () => {
	const files = [
		{ filename: 'garbage.txt', content: new TextEncoder().encode('not an invoice') },
		jsonFile('known.json', invoice({ number: '1' })),
		jsonFile(
			'unknown.json',
			invoice({ number: '2', customer: party({ taxId: 'IT55555555555', legalName: 'New client' }) })
		),
		jsonFile('incoming.json', invoice({ number: '3', supplier: party({ taxId: 'IT99999999999' }) }))
	];
	const result = buildReview(files, pack, registry, ACCOUNT_HOLDER_TAX_ID, [client()]);
	expect(result.recognised).toHaveLength(1);
	expect(result.clarifications).toHaveLength(1);
	expect(result.skipped).toHaveLength(2);
	expect(result.skipped.map((s) => s.reason.kind).toSorted()).toEqual([
		'incoming_invoice',
		'unrecognised_format'
	]);
});
