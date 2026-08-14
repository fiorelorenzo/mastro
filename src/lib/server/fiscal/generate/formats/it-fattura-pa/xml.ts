// Renders a `GeneratableInvoice` as FatturaPA 1.2 XML (#260), against
// Agenzia delle Entrate's specifiche tecniche v1.9.1 `Schema_VFPR12` XSD
// (in force from 15 May 2026 —
// https://www.agenziaentrate.gov.it/portale/specifiche-tecniche-versione-1.9.1-%C2%A0-utilizzabili-dal-15-maggio-2026-).
// The reverse of `import/formats/fattura-pa/xml.ts`: that module turns
// untrusted document bytes into a validated object; this one turns a
// trusted, already-validated `GeneratableInvoice` into bytes, so there is
// no schema-validation boundary to cross here — only the FatturaPA
// character-class and length limits the XSD's own simple types impose
// (`String20Type`, `RateType`, `Amount2DecimalType`, ...), enforced by the
// small formatters below.
//
// Kept string-built rather than object-then-serialised: every element's
// position is fixed by the XSD's own `xs:sequence` order, and building the
// string in that order top to bottom is the most direct way to keep it
// right — the same reasoning `xml.ts` on the import side gives for never
// routing a monetary value through a number coercion, applied to
// structure instead of arithmetic.

import type { LegalText } from '$lib/legal/legal-text';
import { minorUnitsToDecimalString } from '$lib/money';
import { resolveInvoiceRouting } from '$lib/server/domain/invoice';
import type { InvoiceDocumentType } from '$lib/server/import/invoice';
import {
	resolveDefaultTaxTreatment,
	type FiscalPack,
	type ResolvedTaxTreatment
} from '../../../pack';
import type { GeneratableCustomer, GeneratableInvoice, GeneratableParty } from '../../generator';

const NAMESPACE = 'http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2';
const FORMAT_ID = 'FPR12';

/** The reverse of `import/formats/fattura-pa/map.ts`'s
 * `DOCUMENT_TYPE_BY_CODE` — its own file, not a shared import, the same
 * "each format module owns its own literal codes" choice the rest of this
 * file makes (invariant 1's two sanctioned homes, `packs/` and
 * `formats/`, never share a table across a format boundary). */
const DOCUMENT_CODE_BY_TYPE: Record<InvoiceDocumentType, string> = {
	invoice: 'TD01',
	advance_on_invoice: 'TD02',
	advance_on_fee_note: 'TD03',
	credit_note: 'TD04',
	debit_note: 'TD05',
	fee_note: 'TD06'
};

/** FatturaPA's `TipoCassa` code for INPS's Gestione Separata — the fund a
 * consultant with no professional-order cassa (this product's whole
 * target population) pays into. The only fund code this generator ever
 * needs: `it-flat-rate`'s `StatutoryCharge` in the `social_charge` slot
 * models exactly one social-security surcharge (the INPS "rivalsa", art.
 * 1, comma 212, legge 662/1996 — see `packs/it-flat-rate.ts`), and no
 * pack this product ships models a second one. Matches the code already
 * named in `import/invoice.ts`'s own `InvoiceSocialSecurityCharge.fundCode`
 * doc comment for the same real-world fund, read the other direction. */
const SOCIAL_CHARGE_FUND_CODE = 'TC22';

function escapeXml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

function el(tag: string, value: string | null | undefined): string {
	if (value === null || value === undefined) return '';
	return `<${tag}>${escapeXml(value)}</${tag}>`;
}

/** `RateType`/`Amount`-adjacent percentage fields: exactly two decimal
 * digits, e.g. `22` -> `"22.00"`. */
function formatRate(rate: number): string {
	return rate.toFixed(2);
}

/** `QuantitaType`: at least two decimal digits. */
function formatQuantity(quantity: number): string {
	return quantity.toFixed(2);
}

/** `Numero`/`String20Type`: 1-20 characters, Basic Latin only. Throws
 * rather than truncating — a silently shortened invoice number is a
 * different, wrong number, not a formatting nicety. */
function numero(value: string): string {
	// eslint-disable-next-line no-control-regex -- Basic Latin is exactly U+0000-U+007F.
	if (value.length === 0 || value.length > 20 || !/^[\x00-\x7F]+$/.test(value)) {
		throw new Error(
			`invoice number ${JSON.stringify(value)} does not fit FatturaPA's Numero field (1-20 Basic Latin characters)`
		);
	}
	return value;
}

/** `String*LatinType` fields (`Descrizione`, `Denominazione`, `Indirizzo`,
 * `Comune`, ...): 1-`maxLength` characters, Basic Latin or Latin-1
 * Supplement only (`[\p{IsBasicLatin}\p{IsLatin-1Supplement}]`, U+0000 -
 * U+00FF, excluding the C0 control characters, which XML 1.0 forbids in
 * character data at all) — covers accented Italian text but not, concretely, a "smart"
 * em dash or curly quote a word processor substitutes for a typed one.
 * Throws rather than transliterating: silently rewriting a legally
 * meaningful description is worse than telling the self-hoster which
 * field to fix. */
function latinText(fieldName: string, value: string, maxLength: number): string {
	if (value.length === 0 || value.length > maxLength || !/^[\u0020-\u00ff]+$/.test(value)) {
		throw new Error(
			`FatturaPA's ${fieldName} field takes 1-${maxLength} Basic Latin/Latin-1 characters; ` +
				`${JSON.stringify(value)} does not fit (check for a "smart" dash or quote)`
		);
	}
	return value;
}

/** `ProgressivoInvio`/`String10Type`: 1-10 characters. No dedicated
 * transmission counter is modelled — #261, not this issue, owns
 * transmission-status tracking — so the invoice's own already-unique
 * number (#257) doubles as this value, its last 10 characters when
 * longer: SdI only needs this to tell apart several transmission
 * attempts for the same invoice, not to be globally unique by itself. */
function progressivoInvio(invoiceNumber: string): string {
	// eslint-disable-next-line no-control-regex -- Basic Latin is exactly U+0000-U+007F.
	const ascii = invoiceNumber.replace(/[^\x00-\x7F]/g, '');
	if (ascii.length === 0) return '1';
	return ascii.length <= 10 ? ascii : ascii.slice(-10);
}

/**
 * Splits a tax id stored in this codebase's own concatenated form (e.g.
 * `"IT01234567890"`, the same shape `import/formats/fattura-pa/map.ts`'s
 * `fiscalIdString` produces) back into FatturaPA's separate `IdPaese` +
 * `IdCodice`. Falls back to treating the whole value as `IdCodice` under
 * `country` when it carries no such prefix — a self-hoster is free to
 * type a bare VAT number and rely on the country field instead, and
 * either convention round-trips correctly here.
 */
function splitFiscalId(value: string, country: string): { idPaese: string; idCodice: string } {
	const trimmed = value.trim().toUpperCase();
	const idPaese = country.trim().toUpperCase();
	if (trimmed.startsWith(idPaese) && trimmed.length > idPaese.length) {
		return { idPaese, idCodice: trimmed.slice(idPaese.length) };
	}
	return { idPaese, idCodice: trimmed };
}

/** `RiferimentoNormativo`/`String100LatinType` caps at 100 characters. A
 * citation that does not fit is omitted, never truncated: invariant 5
 * requires the annotation verbatim, and a shortened legal citation is a
 * different string, not the same one abbreviated. `Natura` and
 * `RegimeFiscale` still carry the codes SdI's own validation actually
 * checks; this is the informative citation layered on top of them. */
function riferimentoNormativo(legalText: LegalText | null): string | null {
	if (!legalText) return null;
	if (legalText.text.length > 100) return null;
	return /^[\u0020-\u00ff]+$/.test(legalText.text) ? legalText.text : null;
}

function buildIndirizzo(party: GeneratableParty): string {
	const indirizzo = party.addressLine2
		? `${party.addressLine1}, ${party.addressLine2}`
		: party.addressLine1;
	return [
		el('Indirizzo', latinText('Indirizzo', indirizzo, 60)),
		el('CAP', party.addressPostalCode),
		el('Comune', latinText('Comune', party.addressCity, 60)),
		party.addressRegion ? el('Provincia', party.addressRegion) : '',
		el('Nazione', party.country)
	].join('');
}

function buildDatiTrasmissione(
	issuerFiscalId: { idPaese: string; idCodice: string },
	customer: GeneratableCustomer,
	invoiceNumber: string
): string {
	const routing = resolveInvoiceRouting(customer);
	// SdI's own reserved-area default (§3 of docs/specs/2026-08-14-electronic-invoicing.md):
	// used both when the client carries no routing data at all, and
	// alongside `PECDestinatario` when routing falls back to PEC — the
	// field is never left empty.
	const codiceDestinatario = routing.case === 'sdi_code' ? routing.sdiCode : '0000000';
	const pec = routing.case === 'pec' ? el('PECDestinatario', routing.pecAddress) : '';
	return (
		'<DatiTrasmissione>' +
		'<IdTrasmittente>' +
		el('IdPaese', issuerFiscalId.idPaese) +
		el('IdCodice', issuerFiscalId.idCodice) +
		'</IdTrasmittente>' +
		el('ProgressivoInvio', progressivoInvio(invoiceNumber)) +
		el('FormatoTrasmissione', FORMAT_ID) +
		el('CodiceDestinatario', codiceDestinatario) +
		pec +
		'</DatiTrasmissione>'
	);
}

function buildCedentePrestatore(
	practiceProfile: GeneratableParty,
	issuerFiscalId: { idPaese: string; idCodice: string },
	regimeFiscale: string
): string {
	const datiAnagrafici =
		'<IdFiscaleIVA>' +
		el('IdPaese', issuerFiscalId.idPaese) +
		el('IdCodice', issuerFiscalId.idCodice) +
		'</IdFiscaleIVA>' +
		el('CodiceFiscale', practiceProfile.taxId.trim().toUpperCase()) +
		`<Anagrafica>${el('Denominazione', latinText('Denominazione', practiceProfile.legalName, 80))}</Anagrafica>` +
		el('RegimeFiscale', regimeFiscale);
	return (
		`<CedentePrestatore><DatiAnagrafici>${datiAnagrafici}</DatiAnagrafici>` +
		`<Sede>${buildIndirizzo(practiceProfile)}</Sede></CedentePrestatore>`
	);
}

function buildCessionarioCommittente(customer: GeneratableCustomer): string {
	let idFiscaleIva = '';
	if (customer.vatId) {
		const { idPaese, idCodice } = splitFiscalId(customer.vatId, customer.country);
		idFiscaleIva = `<IdFiscaleIVA>${el('IdPaese', idPaese)}${el('IdCodice', idCodice)}</IdFiscaleIVA>`;
	}
	const datiAnagrafici =
		idFiscaleIva +
		el('CodiceFiscale', customer.taxId.trim().toUpperCase()) +
		`<Anagrafica>${el('Denominazione', latinText('Denominazione', customer.legalName, 80))}</Anagrafica>`;
	return (
		`<CessionarioCommittente><DatiAnagrafici>${datiAnagrafici}</DatiAnagrafici>` +
		`<Sede>${buildIndirizzo(customer)}</Sede></CessionarioCommittente>`
	);
}

function buildDatiCassaPrevidenziale(
	invoice: GeneratableInvoice,
	treatment: ResolvedTaxTreatment,
	pack: FiscalPack
): string {
	if (invoice.socialCharge === null) return '';
	const charge = pack.charges.find((c) => c.slot === 'social_charge');
	if (!charge || charge.amount.kind !== 'percentage') {
		throw new Error(
			`invoice carries a social charge but pack ${pack.id}@${pack.version} declares no ` +
				"percentage-kind StatutoryCharge in the 'social_charge' slot to read its rate from"
		);
	}
	const parts = [
		el('TipoCassa', SOCIAL_CHARGE_FUND_CODE),
		el('AlCassa', formatRate(charge.amount.rate * 100)),
		el('ImportoContributoCassa', minorUnitsToDecimalString(invoice.socialCharge, invoice.currency)),
		el('ImponibileCassa', minorUnitsToDecimalString(invoice.taxableAmount, invoice.currency)),
		el('AliquotaIVA', formatRate(treatment.taxRate))
	];
	if (treatment.code) parts.push(el('Natura', treatment.code));
	return `<DatiCassaPrevidenziale>${parts.join('')}</DatiCassaPrevidenziale>`;
}

function buildDatiGeneraliDocumento(
	invoice: GeneratableInvoice,
	treatment: ResolvedTaxTreatment,
	pack: FiscalPack
): string {
	const parts = [
		el('TipoDocumento', DOCUMENT_CODE_BY_TYPE[invoice.documentType]),
		el('Divisa', invoice.currency),
		el('Data', invoice.issueDate),
		el('Numero', numero(invoice.number))
	];
	if (invoice.stampDuty !== null) {
		parts.push(
			'<DatiBollo>' +
				el('BolloVirtuale', 'SI') +
				el('ImportoBollo', minorUnitsToDecimalString(invoice.stampDuty, invoice.currency)) +
				'</DatiBollo>'
		);
	}
	const cassa = buildDatiCassaPrevidenziale(invoice, treatment, pack);
	if (cassa) parts.push(cassa);
	parts.push(
		el('ImportoTotaleDocumento', minorUnitsToDecimalString(invoice.total, invoice.currency))
	);
	return `<DatiGeneraliDocumento>${parts.join('')}</DatiGeneraliDocumento>`;
}

function buildDettaglioLinee(invoice: GeneratableInvoice, treatment: ResolvedTaxTreatment): string {
	return invoice.lines
		.map((line, index) => {
			const parts = [
				el('NumeroLinea', String(index + 1)),
				el('Descrizione', latinText('Descrizione', line.description, 1000)),
				el('Quantita', formatQuantity(line.quantity)),
				el('PrezzoUnitario', minorUnitsToDecimalString(line.unitPrice, invoice.currency)),
				el('PrezzoTotale', minorUnitsToDecimalString(line.amount, invoice.currency)),
				el('AliquotaIVA', formatRate(treatment.taxRate))
			];
			if (treatment.code) parts.push(el('Natura', treatment.code));
			return `<DettaglioLinee>${parts.join('')}</DettaglioLinee>`;
		})
		.join('');
}

function buildDatiRiepilogo(invoice: GeneratableInvoice, treatment: ResolvedTaxTreatment): string {
	const parts = [el('AliquotaIVA', formatRate(treatment.taxRate))];
	if (treatment.code) parts.push(el('Natura', treatment.code));
	parts.push(
		el('ImponibileImporto', minorUnitsToDecimalString(invoice.taxableAmount, invoice.currency)),
		el('Imposta', minorUnitsToDecimalString(invoice.taxAmount, invoice.currency))
	);
	const reference = riferimentoNormativo(treatment.legalText);
	if (reference) parts.push(el('RiferimentoNormativo', reference));
	return `<DatiRiepilogo>${parts.join('')}</DatiRiepilogo>`;
}

function buildDatiPagamento(invoice: GeneratableInvoice): string {
	if (!invoice.paymentMethod) return '';
	const parts = [
		el('ModalitaPagamento', invoice.paymentMethod),
		el('DataScadenzaPagamento', invoice.dueDate),
		el('ImportoPagamento', minorUnitsToDecimalString(invoice.total, invoice.currency))
	];
	if (invoice.iban) parts.push(el('IBAN', invoice.iban));
	return (
		`<DatiPagamento>${el('CondizioniPagamento', 'TP02')}` +
		`<DettaglioPagamento>${parts.join('')}</DettaglioPagamento></DatiPagamento>`
	);
}

/**
 * Renders `invoice` as a complete FatturaPA 1.2 document, validated
 * end-to-end against `Schema_VFPR12` (v1.9.1) by
 * `generator.test.ts`. Throws when a field this format legally requires
 * is missing on `practiceProfile` or `pack` — see each check below for
 * which, and why there is no sensible default.
 */
export function buildFatturaPaXml(
	invoice: GeneratableInvoice,
	practiceProfile: GeneratableParty,
	pack: FiscalPack
): string {
	if (!practiceProfile.vatId) {
		throw new Error(
			'practice profile has no VAT id — required for FatturaPA CedentePrestatore.IdFiscaleIVA'
		);
	}
	if (!pack.taxRegimeCode) {
		throw new Error(
			`pack ${pack.id}@${pack.version} declares no taxRegimeCode — required for FatturaPA RegimeFiscale`
		);
	}
	const treatment = resolveDefaultTaxTreatment(pack);
	if (!treatment) {
		throw new Error(
			`pack ${pack.id}@${pack.version} declares no default tax treatment — required to resolve FatturaPA's Natura/AliquotaIVA`
		);
	}
	if (invoice.lines.length === 0) {
		throw new Error(`invoice ${invoice.number} has no lines to generate DettaglioLinee from`);
	}

	const issuerFiscalId = splitFiscalId(practiceProfile.vatId, practiceProfile.country);
	const header =
		'<FatturaElettronicaHeader>' +
		buildDatiTrasmissione(issuerFiscalId, invoice.customer, invoice.number) +
		buildCedentePrestatore(practiceProfile, issuerFiscalId, pack.taxRegimeCode) +
		buildCessionarioCommittente(invoice.customer) +
		'</FatturaElettronicaHeader>';
	const body =
		'<FatturaElettronicaBody>' +
		`<DatiGenerali>${buildDatiGeneraliDocumento(invoice, treatment, pack)}</DatiGenerali>` +
		'<DatiBeniServizi>' +
		buildDettaglioLinee(invoice, treatment) +
		buildDatiRiepilogo(invoice, treatment) +
		'</DatiBeniServizi>' +
		buildDatiPagamento(invoice) +
		'</FatturaElettronicaBody>';

	return (
		'<?xml version="1.0" encoding="UTF-8"?>\n' +
		// The namespace is declared with a prefix on the root element only,
		// never as a default `xmlns`: the schema sets no
		// `elementFormDefault`, which defaults to `unqualified` — every
		// descendant element below must stay in no namespace, and a default
		// `xmlns` here would put all of them in this one instead, which
		// `Schema_VFPR12.xsd` then rejects (each one reported as
		// "not expected", the schema validator's way of saying "an element
		// with this name exists, just not in this namespace").
		`<p:FatturaElettronica xmlns:p="${NAMESPACE}" versione="${FORMAT_ID}">${header}${body}</p:FatturaElettronica>`
	);
}
