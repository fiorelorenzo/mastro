// #260 acceptance, end to end: a real `it-flat-rate` and a real
// `it-standard` invoice each generate FatturaPA XML that validates
// against Agenzia delle Entrate's own published `Schema_VFPR12` XSD
// (specifiche tecniche v1.9.1, in force from 15 May 2026 —
// `fixtures/Schema_VFPR12.xsd`, fetched from
// https://www.agenziaentrate.gov.it/portale/specifiche-tecniche-versione-1.9.1-%C2%A0-utilizzabili-dal-15-maggio-2026-
// on 2026-08-14) and carries the fields each pack requires.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateXML } from 'xmllint-wasm';
import { expect, test } from 'vitest';
import { evaluateInvoiceCharges, resolveDefaultTaxTreatment } from '../../../pack';
import { itFlatRatePack } from '../../../packs/it-flat-rate';
import { itStandardPack } from '../../../packs/it-standard';
import type { GeneratableCustomer, GeneratableInvoice, GeneratableParty } from '../../generator';
import { itFatturaPaGenerator } from './generator';
import { buildFatturaPaXml } from './xml';

const fixtureUrl = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

const SCHEMA = readFileSync(fixtureUrl('Schema_VFPR12.xsd'), 'utf-8');
const XMLDSIG_SCHEMA = readFileSync(fixtureUrl('xmldsig-core-schema.xsd'), 'utf-8');

async function validateAgainstSchemaVfpr12(xml: string) {
	return validateXML({
		xml: [{ fileName: 'generated.xml', contents: xml }],
		schema: [SCHEMA],
		preload: [
			{
				fileName: 'http://www.w3.org/TR/2002/REC-xmldsig-core-20020212/xmldsig-core-schema.xsd',
				contents: XMLDSIG_SCHEMA
			}
		]
	});
}

const PRACTICE_PROFILE: GeneratableParty = {
	legalName: 'Giulia Bianchi',
	// A codice fiscale, deliberately not "IT"-prefixed — CedentePrestatore's
	// `CodiceFiscale` (`CodiceFiscaleType`) has no country component,
	// unlike `IdFiscaleIVA`.
	taxId: 'BNCGLI85A41H501K',
	vatId: 'IT01234567890',
	country: 'IT',
	addressLine1: 'Via dei Consulenti 8',
	addressLine2: null,
	addressCity: 'Bologna',
	addressPostalCode: '40100',
	addressRegion: 'BO'
};

const CUSTOMER: GeneratableCustomer = {
	legalName: 'Nordwind Logistics Srl',
	taxId: 'IT09876543210',
	vatId: 'IT09876543210',
	country: 'IT',
	addressLine1: 'Corso Italia 5',
	addressLine2: 'Piano 3',
	addressCity: 'Milano',
	addressPostalCode: '20100',
	addressRegion: 'MI',
	sdiCode: 'ABCDE12',
	pecAddress: null
};

/** Builds a well-formed `GeneratableInvoice` for `pack`, its charges and
 * default treatment resolved the same way `repositories/invoice-form.ts`'s
 * `resolveInvoiceTax` and `seed/demo-seed.ts` resolve them — never
 * hand-picked figures that happen to look right. */
function invoiceUnder(
	pack: typeof itFlatRatePack | typeof itStandardPack,
	overrides: Partial<GeneratableInvoice> = {}
): GeneratableInvoice {
	const taxableAmount = overrides.taxableAmount ?? (100_000 as GeneratableInvoice['taxableAmount']);
	const treatment = resolveDefaultTaxTreatment(pack);
	if (!treatment) throw new Error(`${pack.id} declares no default treatment`);
	const taxAmount = Math.round(
		(taxableAmount * treatment.taxRate) / 100
	) as GeneratableInvoice['taxAmount'];
	const charges = evaluateInvoiceCharges(pack, { invoiceTotal: taxableAmount });
	const total = (taxableAmount +
		taxAmount +
		(charges.stampDuty ?? 0) +
		(charges.socialCharge ?? 0)) as GeneratableInvoice['total'];
	return {
		number: 'INV-2026-0001',
		issueDate: '2026-06-15',
		documentType: 'invoice',
		currency: 'EUR',
		taxableAmount,
		taxAmount,
		total,
		stampDuty: charges.stampDuty,
		socialCharge: charges.socialCharge,
		dueDate: '2026-07-15',
		paymentMethod: 'MP05',
		iban: 'IT60X0542811101000000123456',
		lines: [
			{
				description: 'Consulenza tecnica - giornate di lavoro',
				quantity: 10,
				unitPrice: (taxableAmount / 10) as GeneratableInvoice['taxableAmount'],
				amount: taxableAmount
			}
		],
		customer: CUSTOMER,
		...overrides
	};
}

test('an it-flat-rate invoice generates FatturaPA XML valid against Schema_VFPR12 v1.9.1, with RF19, N2.2 and stamp duty above 77,47 EUR', async () => {
	// 1000.00 EUR taxable, comfortably over the 77.47 EUR stamp-duty
	// threshold (#33 / docs/specs/2026-08-14-electronic-invoicing.md §1).
	const invoice = invoiceUnder(itFlatRatePack);
	expect(invoice.stampDuty).toBe(200); // 2.00 EUR, the pack's own fixed amount.
	expect(invoice.socialCharge).toBeGreaterThan(0); // the INPS rivalsa, 4% unconditional.

	const xml = buildFatturaPaXml(invoice, PRACTICE_PROFILE, itFlatRatePack);

	expect(xml).toContain('<RegimeFiscale>RF19</RegimeFiscale>');
	expect(xml).toContain('<Natura>N2.2</Natura>');
	expect(xml).toContain('<BolloVirtuale>SI</BolloVirtuale>');
	expect(xml).toContain('<ImportoBollo>2.00</ImportoBollo>');
	expect(xml).toContain(`<Numero>${invoice.number}</Numero>`);
	// The real legal text is 112 characters, over String100LatinType's
	// 100-char cap — omitted rather than truncated (see xml.ts's
	// `riferimentoNormativo`).
	expect(xml).not.toContain('RiferimentoNormativo');
	// Total reconciles: taxable + tax (0, exempt) + stamp duty + social charge.
	expect(xml).toContain(
		`<ImportoTotaleDocumento>${(invoice.total / 100).toFixed(2)}</ImportoTotaleDocumento>`
	);

	const result = await validateAgainstSchemaVfpr12(xml);
	expect(result.errors).toEqual([]);
	expect(result.valid).toBe(true);
});

test('an it-standard invoice generates FatturaPA XML valid against Schema_VFPR12 v1.9.1, with RF01 and the ordinary 22% rate', async () => {
	const invoice = invoiceUnder(itStandardPack);
	expect(invoice.stampDuty).toBeNull(); // it-standard models no stamp-duty charge.
	expect(invoice.socialCharge).toBeNull(); // it-standard models no social charge.
	expect(invoice.taxAmount).toBe(22_000); // 22% of 1000.00 EUR.

	const xml = buildFatturaPaXml(invoice, PRACTICE_PROFILE, itStandardPack);

	expect(xml).toContain('<RegimeFiscale>RF01</RegimeFiscale>');
	expect(xml).not.toContain('<Natura>'); // the ordinary case carries no treatment code.
	expect(xml).not.toContain('DatiBollo');
	expect(xml).not.toContain('DatiCassaPrevidenziale');
	expect(xml).toContain('<AliquotaIVA>22.00</AliquotaIVA>');
	expect(xml).toContain(`<Numero>${invoice.number}</Numero>`);

	const result = await validateAgainstSchemaVfpr12(xml);
	expect(result.errors).toEqual([]);
	expect(result.valid).toBe(true);
});

test('the CodiceDestinatario falls back to the SdI reserved-area default when the client has no sdiCode or pecAddress', async () => {
	const invoice = invoiceUnder(itStandardPack, {
		customer: { ...CUSTOMER, sdiCode: null, pecAddress: null }
	});
	const xml = buildFatturaPaXml(invoice, PRACTICE_PROFILE, itStandardPack);
	expect(xml).toContain('<CodiceDestinatario>0000000</CodiceDestinatario>');
	expect(xml).not.toContain('PECDestinatario');

	const result = await validateAgainstSchemaVfpr12(xml);
	expect(result.valid).toBe(true);
});

test('the CodiceDestinatario falls back to the reserved default with PECDestinatario carried alongside it when only a PEC address is on file', async () => {
	const invoice = invoiceUnder(itStandardPack, {
		customer: { ...CUSTOMER, sdiCode: null, pecAddress: 'fatture@nordwind.pec.it' }
	});
	const xml = buildFatturaPaXml(invoice, PRACTICE_PROFILE, itStandardPack);
	expect(xml).toContain('<CodiceDestinatario>0000000</CodiceDestinatario>');
	expect(xml).toContain('<PECDestinatario>fatture@nordwind.pec.it</PECDestinatario>');

	const result = await validateAgainstSchemaVfpr12(xml);
	expect(result.valid).toBe(true);
});

test('throws rather than silently emitting a description outside Basic Latin/Latin-1 (a "smart" em dash, concretely)', () => {
	const invoice = invoiceUnder(itStandardPack, {
		lines: [
			{
				description: 'Consulenza tecnica \u2014 giornate di lavoro',
				quantity: 10,
				unitPrice: 10_000 as GeneratableInvoice['taxableAmount'],
				amount: 100_000 as GeneratableInvoice['taxableAmount']
			}
		]
	});
	expect(() => buildFatturaPaXml(invoice, PRACTICE_PROFILE, itStandardPack)).toThrow(/Descrizione/);
});

// A C0 control character is not merely outside the field's declared
// character class: XML 1.0 forbids it in character data outright, so
// emitting one would produce a document no parser will accept, which the
// XSD check above could never catch because parsing fails first.
test('throws rather than emitting a control character XML itself forbids', () => {
	const invoice = invoiceUnder(itStandardPack, {
		lines: [
			{
				description: 'Consulenza tecnica\u0000 marzo',
				quantity: 10,
				unitPrice: 10_000 as GeneratableInvoice['taxableAmount'],
				amount: 100_000 as GeneratableInvoice['taxableAmount']
			}
		]
	});
	expect(() => buildFatturaPaXml(invoice, PRACTICE_PROFILE, itStandardPack)).toThrow(/Descrizione/);
});

test('throws rather than generating a document missing the mandatory VAT id', () => {
	const invoice = invoiceUnder(itStandardPack);
	expect(() =>
		buildFatturaPaXml(invoice, { ...PRACTICE_PROFILE, vatId: null }, itStandardPack)
	).toThrow(/VAT id/);
});

test('throws rather than generating a document under a pack with no taxRegimeCode', () => {
	const invoice = invoiceUnder(itStandardPack);
	expect(() =>
		buildFatturaPaXml(invoice, PRACTICE_PROFILE, { ...itStandardPack, taxRegimeCode: undefined })
	).toThrow(/taxRegimeCode/);
});

test('the FatturaPA generator produces a downloadable .xml document, stored with the practice VAT id and invoice number in the filename', () => {
	const invoice = invoiceUnder(itFlatRatePack);
	const document = itFatturaPaGenerator.generate(invoice, PRACTICE_PROFILE, itFlatRatePack);
	expect(document.mime).toBe('application/xml');
	expect(document.filename).toBe('IT01234567890_INV20260001.xml');
	expect(new TextDecoder().decode(document.bytes)).toContain('<FatturaElettronica');
});
