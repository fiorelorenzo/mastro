// #42 acceptance, end to end: the real (anonymised) fixture parses into a
// complete invoice with no human input, stamp duty and the social charge
// survive, and the due date comes from the document. Also proves the trap
// #42/#45 call out: the fixture's transmitter is a different tax id from
// the supplier, and direction detection (#45) still classifies correctly
// because it reads the supplier.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { classifyImportedInvoice } from '../../direction';
import { importFile } from '../../importer';
import { buildAdapterRegistry } from '../../registry';
import { fatturaPaAdapter } from './adapter';

function fixture(name: string): { filename: string; content: Uint8Array } {
	return {
		filename: name,
		content: readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)))
	};
}

const CONSULTING_INVOICE = 'fpr12-consulting-invoice.xml';

test('detect claims a well-formed FPR12 document', () => {
	expect(fatturaPaAdapter.detect(fixture(CONSULTING_INVOICE))).toBe(true);
});

test('detect rejects a document transmitted under a different format code (FPA12, addressed to a Public Administration)', () => {
	// Otherwise-identical, fully valid fixture with both occurrences of the
	// format code changed — proves detect() is rejecting on the format
	// code specifically, not on some incidental structural difference.
	const original = fixture(CONSULTING_INVOICE);
	const asFpa12 = Buffer.from(
		new TextDecoder().decode(original.content).replaceAll('FPR12', 'FPA12'),
		'utf-8'
	);
	expect(fatturaPaAdapter.detect({ filename: 'pa.xml', content: asFpa12 })).toBe(false);
});

test('detect rejects an unrelated, well-formed XML document', () => {
	const other = Buffer.from('<Ledger><Entry amount="10.00"/></Ledger>', 'utf-8');
	expect(fatturaPaAdapter.detect({ filename: 'ledger.xml', content: other })).toBe(false);
});

test('detect rejects non-XML bytes without throwing', () => {
	const garbage = new Uint8Array([0x00, 0xff, 0x13, 0x37, 0x00, 0xde, 0xad, 0xbe, 0xef]);
	expect(() =>
		fatturaPaAdapter.detect({ filename: 'garbage.bin', content: garbage })
	).not.toThrow();
	expect(fatturaPaAdapter.detect({ filename: 'garbage.bin', content: garbage })).toBe(false);
});

test('parse maps the fixture into a complete invoice with no human input', () => {
	const invoice = fatturaPaAdapter.parse(fixture(CONSULTING_INVOICE));

	expect(invoice.number).toBe('6/2026');
	expect(invoice.issueDate).toBe('2026-03-15');
	expect(invoice.documentType).toBe('fee_note');
	expect(invoice.currency).toBe('EUR');

	expect(invoice.supplier).toMatchObject({
		legalName: 'Chiara Bianchi',
		taxId: 'IT01234567890',
		nationalIdentifier: 'BNCCHR85M41H501Z',
		country: 'IT',
		addressCity: 'Milano'
	});
	expect(invoice.customer).toMatchObject({
		legalName: 'Esempio Servizi S.r.l.',
		taxId: 'IT09876543210',
		addressCity: 'Roma'
	});

	expect(invoice.lines).toEqual([
		{
			description: 'Consulenza professionale - marzo 2026',
			quantity: 5,
			unitPrice: 20000,
			amount: 100000,
			taxRate: 0
		}
	]);

	expect(invoice.taxSummary).toEqual([
		{
			taxRate: 0,
			taxTreatmentCode: 'N2',
			statutoryReference: {
				kind: 'legal-text',
				language: 'it',
				text: "Operazione senza addebito d'imposta ai sensi dell'art. 1, commi da 54 a 89, Legge 23 dicembre 2014, n. 190, e successive modificazioni"
			},
			taxableAmount: 104000,
			taxAmount: 0
		}
	]);
	expect(invoice.taxableAmount).toBe(104000);
	expect(invoice.taxAmount).toBe(0);
	expect(invoice.total).toBe(104200);

	// Stamp duty and the social charge survive, never dropped.
	expect(invoice.stampDuty).toBe(200);
	expect(invoice.socialSecurityCharges).toEqual([
		{ fundCode: 'TC22', rate: 4, amount: 4000, taxableAmount: 100000, taxRateOnCharge: 0 }
	]);

	// The due date comes from the document, for every instalment, never
	// recomputed from the issue date.
	expect(invoice.paymentTerms).toEqual([
		{
			conditionCode: 'TP01',
			installments: [
				{
					dueDate: '2026-04-14',
					amount: 52100,
					method: 'MP05',
					iban: 'IT60X0542811101000000123456'
				},
				{
					dueDate: '2026-05-14',
					amount: 52100,
					method: 'MP05',
					iban: 'IT60X0542811101000000123456'
				}
			]
		}
	]);

	// The transmitter is a third party, distinct from the supplier — an
	// invoicing service filing on the account holder's behalf, per the
	// fixture's own header comment.
	expect(invoice.transmission).toEqual({
		transmitterId: 'IT11122233344',
		progressiveNumber: '00042'
	});
	expect(invoice.transmission.transmitterId).not.toBe(invoice.supplier.taxId);
});

test('the importer resolves this adapter through a pack that declares FPR12, end to end', () => {
	const registry = buildAdapterRegistry([fatturaPaAdapter]);
	const pack = { formats: ['FPR12'] };
	const result = importFile(pack, registry, fixture(CONSULTING_INVOICE));
	expect(result.kind).toBe('parsed');
	if (result.kind !== 'parsed') throw new Error('unreachable');
	expect(result.adapterId).toBe('FPR12');
	expect(result.invoice.number).toBe('6/2026');
});

test('direction detection classifies the fixture as outgoing when the account holder is the supplier', () => {
	const invoice = fatturaPaAdapter.parse(fixture(CONSULTING_INVOICE));
	expect(classifyImportedInvoice(invoice, 'IT01234567890').kind).toBe('outgoing');
});

test('direction detection classifies the fixture as incoming when the account holder is not the supplier, and never as outgoing by reading the transmitter instead', () => {
	const invoice = fatturaPaAdapter.parse(fixture(CONSULTING_INVOICE));

	// The account holder configured is the fixture's transmitter, not its
	// supplier — if direction detection ever fell back to reading
	// `transmission`, this would wrongly come back outgoing.
	const outcome = classifyImportedInvoice(invoice, invoice.transmission.transmitterId);
	expect(outcome.kind).toBe('incoming_skipped');
	if (outcome.kind !== 'incoming_skipped') throw new Error('unreachable');
	expect(outcome.reason.supplierTaxId).toBe('IT01234567890');
});
