// #47. `buildReview` is pure, so it is tested the same way `importer.ts`
// is tested (see importer.test.ts): a throwaway adapter registered under a
// format id that exists nowhere else, detecting invoices by an in-memory
// marker instead of a real document format.
import { expect, test } from 'vitest';
import type { ImportableFile, InvoiceFormatAdapter } from './adapter';
import type { ClientMatchCandidate } from './client-match';
import { buildAdapterRegistry } from './registry';
import { buildReview } from './review';
import type { Invoice, InvoiceParty } from './invoice';

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

/** Encodes an `Invoice` as JSON in the file's own bytes, and an adapter
 * that decodes it back — a throwaway "format" whose only job is to hand
 * `buildReview` exactly the invoice a test wants, without a real XML
 * document. `malformed.json` is a magic filename this adapter claims via
 * `detect` but always fails to `parse`, exercising the malformed-document
 * path (see adapter.ts: `parse` may throw on a document that passed
 * `detect`). */
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

test('a known customer (matched by tax id) is recognised silently, no clarification', () => {
	const clients: ClientMatchCandidate[] = [
		{ id: 'client-1', taxId: 'IT01234567890', legalName: 'Rossi Consulting srl' }
	];
	const result = buildReview(
		[jsonFile('a.json', invoice())],
		pack,
		registry,
		ACCOUNT_HOLDER_TAX_ID,
		clients
	);
	expect(result.recognised).toEqual([
		{
			filename: 'a.json',
			clientId: 'client-1',
			clientLegalName: 'Rossi Consulting srl',
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

test('a repeated natural key within the batch is already_present, not recognised twice', () => {
	const clients: ClientMatchCandidate[] = [
		{ id: 'client-1', taxId: 'IT01234567890', legalName: 'Rossi Consulting srl' }
	];
	const original = invoice({ number: '1', issueDate: '2024-01-15' });
	const duplicate = invoice({ number: '1', issueDate: '2024-01-15' });
	const result = buildReview(
		[jsonFile('a.json', original), jsonFile('a-copy.json', duplicate)],
		pack,
		registry,
		ACCOUNT_HOLDER_TAX_ID,
		clients
	);
	expect(result.recognised.map((f) => f.filename)).toEqual(['a.json']);
	expect(result.alreadyPresent).toEqual([
		{
			filename: 'a-copy.json',
			duplicateOfFilename: 'a.json',
			invoice: expect.objectContaining({ number: '1' })
		}
	]);
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

test('a mixed folder sorts every file into exactly one bucket', () => {
	const clients: ClientMatchCandidate[] = [
		{ id: 'client-1', taxId: 'IT01234567890', legalName: 'Rossi Consulting srl' }
	];
	const files = [
		{ filename: 'garbage.txt', content: new TextEncoder().encode('not an invoice') },
		jsonFile('known.json', invoice({ number: '1' })),
		jsonFile(
			'unknown.json',
			invoice({ number: '2', customer: party({ taxId: 'IT55555555555', legalName: 'New client' }) })
		),
		jsonFile('incoming.json', invoice({ number: '3', supplier: party({ taxId: 'IT99999999999' }) }))
	];
	const result = buildReview(files, pack, registry, ACCOUNT_HOLDER_TAX_ID, clients);
	expect(result.recognised).toHaveLength(1);
	expect(result.clarifications).toHaveLength(1);
	expect(result.skipped).toHaveLength(2);
	expect(result.skipped.map((s) => s.reason.kind).toSorted()).toEqual([
		'incoming_invoice',
		'unrecognised_format'
	]);
});
