// Maps a parsed FatturaPA 1.2 document onto the neutral `Invoice` shape
// (#42). Pure: no I/O, so every case is a fixture and an assertion, no
// mocking required.

import { legalText } from '$lib/legal/legal-text';
import { computeDueDate } from '$lib/server/domain/contract';
import type { PaymentTerms } from '$lib/server/db/schema/contract';
import { decimalStringToMinorUnits } from '../../decimal';
import { sumMinorUnits } from '$lib/money';
import type {
	Invoice,
	InvoiceDocumentType,
	InvoiceLine,
	InvoiceParty,
	InvoicePaymentTerms,
	InvoiceSocialSecurityCharge,
	InvoiceTaxSummary
} from '../../invoice';
import type {
	RawCedentePrestatore,
	RawCessionarioCommittente,
	RawDatiCassaPrevidenziale,
	RawDatiPagamento,
	RawDatiRiepilogo,
	RawDettaglioLinee,
	RawFatturaElettronica,
	RawFatturaElettronicaBody,
	RawIdFiscale,
	RawIndirizzo
} from './xml';

const DOCUMENT_TYPE_BY_CODE: Record<string, InvoiceDocumentType> = {
	TD01: 'invoice',
	TD02: 'advance_on_invoice',
	TD03: 'advance_on_fee_note',
	TD04: 'credit_note',
	TD05: 'debit_note',
	TD06: 'fee_note'
};

function fiscalIdString(id: RawIdFiscale): string {
	return `${id.IdPaese}${id.IdCodice}`;
}

function partyName(anagrafica: {
	Denominazione?: string;
	Nome?: string;
	Cognome?: string;
}): string {
	if (anagrafica.Denominazione !== undefined) return anagrafica.Denominazione;
	if (anagrafica.Nome !== undefined && anagrafica.Cognome !== undefined) {
		return `${anagrafica.Nome} ${anagrafica.Cognome}`;
	}
	throw new Error('Anagrafica has neither Denominazione nor Nome/Cognome');
}

function partyAddress(sede: RawIndirizzo) {
	return {
		addressLine1: sede.NumeroCivico ? `${sede.Indirizzo} ${sede.NumeroCivico}` : sede.Indirizzo,
		addressCity: sede.Comune,
		addressPostalCode: sede.CAP,
		addressRegion: sede.Provincia,
		// The schema declares `Nazione` defaulting to "IT" for a document
		// that omits it; fast-xml-parser has no notion of XSD defaults, so
		// the fallback is applied here instead of being silently absent.
		country: sede.Nazione ?? 'IT'
	};
}

function mapSupplier(cedente: RawCedentePrestatore): InvoiceParty {
	const anagrafici = cedente.DatiAnagrafici;
	return {
		legalName: partyName(anagrafici.Anagrafica),
		// `IdFiscaleIVA` is mandatory for CedentePrestatore, `CodiceFiscale`
		// is not — direction detection (#45) needs a field every supplier
		// carries, so `taxId` reads the one the schema guarantees.
		taxId: fiscalIdString(anagrafici.IdFiscaleIVA),
		nationalIdentifier: anagrafici.CodiceFiscale,
		...partyAddress(cedente.Sede)
	};
}

function mapCustomer(cessionario: RawCessionarioCommittente): InvoiceParty {
	const anagrafici = cessionario.DatiAnagrafici;
	// Unlike the supplier, `IdFiscaleIVA` is optional for the customer (an
	// individual buyer may carry only a `CodiceFiscale`); fall back to it
	// only when the VAT id is genuinely absent, rather than mapping an
	// empty string, and reuse the fiscal code as `nationalIdentifier` in
	// that case since it is the party's sole national id on file.
	if (anagrafici.IdFiscaleIVA !== undefined) {
		return {
			legalName: partyName(anagrafici.Anagrafica),
			taxId: fiscalIdString(anagrafici.IdFiscaleIVA),
			nationalIdentifier: anagrafici.CodiceFiscale,
			...partyAddress(cessionario.Sede)
		};
	}
	if (anagrafici.CodiceFiscale === undefined) {
		throw new Error('CessionarioCommittente has neither IdFiscaleIVA nor CodiceFiscale');
	}
	return {
		legalName: partyName(anagrafici.Anagrafica),
		taxId: anagrafici.CodiceFiscale,
		...partyAddress(cessionario.Sede)
	};
}

function mapLine(linea: RawDettaglioLinee): InvoiceLine {
	return {
		description: linea.Descrizione,
		quantity: linea.Quantita !== undefined ? Number(linea.Quantita) : 1,
		unitPrice: decimalStringToMinorUnits(linea.PrezzoUnitario),
		amount: decimalStringToMinorUnits(linea.PrezzoTotale),
		taxRate: Number(linea.AliquotaIVA)
	};
}

function mapTaxSummary(riepilogo: RawDatiRiepilogo): InvoiceTaxSummary {
	return {
		taxRate: Number(riepilogo.AliquotaIVA),
		taxTreatmentCode: riepilogo.Natura,
		statutoryReference:
			riepilogo.RiferimentoNormativo !== undefined
				? legalText('it', riepilogo.RiferimentoNormativo)
				: undefined,
		taxableAmount: decimalStringToMinorUnits(riepilogo.ImponibileImporto),
		taxAmount: decimalStringToMinorUnits(riepilogo.Imposta)
	};
}

function mapSocialCharge(cassa: RawDatiCassaPrevidenziale): InvoiceSocialSecurityCharge {
	return {
		fundCode: cassa.TipoCassa,
		rate: Number(cassa.AlCassa),
		amount: decimalStringToMinorUnits(cassa.ImportoContributoCassa),
		taxableAmount:
			cassa.ImponibileCassa !== undefined
				? decimalStringToMinorUnits(cassa.ImponibileCassa)
				: undefined,
		taxRateOnCharge: Number(cassa.AliquotaIVA)
	};
}

function mapPaymentTerms(pagamento: RawDatiPagamento): InvoicePaymentTerms {
	return {
		conditionCode: pagamento.CondizioniPagamento,
		installments: pagamento.DettaglioPagamento.map((dettaglio) => {
			if (dettaglio.DataScadenzaPagamento !== undefined) {
				return {
					dueDate: dettaglio.DataScadenzaPagamento,
					dueDateSource: 'document' as const,
					amount: decimalStringToMinorUnits(dettaglio.ImportoPagamento),
					method: dettaglio.ModalitaPagamento,
					iban: dettaglio.IBAN
				};
			}
			if (
				dettaglio.DataRiferimentoTerminiPagamento !== undefined &&
				dettaglio.GiorniTerminiPagamento !== undefined
			) {
				// The schema also allows expressing a due date as a relative
				// term (`GiorniTerminiPagamento` days after
				// `DataRiferimentoTerminiPagamento`) instead of an explicit
				// `DataScadenzaPagamento`. #101: the due date still comes
				// from the document, never invented — it is computed here
				// from the document's own reference date and day count,
				// the same "net N days" arithmetic `computeDueDate` already
				// does for a contract's own payment terms, applied to the
				// document's terms instead of the contract's.
				const terms: PaymentTerms = {
					kind: 'net',
					days: Number(dettaglio.GiorniTerminiPagamento)
				};
				const due = computeDueDate(
					terms,
					new Date(`${dettaglio.DataRiferimentoTerminiPagamento}T00:00:00Z`)
				);
				return {
					dueDate: due.toISOString().slice(0, 10),
					dueDateSource: 'computed' as const,
					amount: decimalStringToMinorUnits(dettaglio.ImportoPagamento),
					method: dettaglio.ModalitaPagamento,
					iban: dettaglio.IBAN
				};
			}
			throw new Error(
				'DettaglioPagamento has neither DataScadenzaPagamento nor DataRiferimentoTerminiPagamento/GiorniTerminiPagamento to compute a due date from'
			);
		})
	};
}

/** Maps a single `FatturaElettronicaBody` plus the `FatturaElettronicaHeader`
 * it shares with every other body in the same file onto an `Invoice`.
 * Throws on a well-formed body this adapter does not (yet) support — a
 * document omitting `ImportoTotaleDocumento`, most concretely — rather
 * than silently parsing part of it. */
function mapBody(
	header: RawFatturaElettronica['FatturaElettronicaHeader'],
	body: RawFatturaElettronicaBody
): Invoice {
	const documento = body.DatiGenerali.DatiGeneraliDocumento;

	const documentType = DOCUMENT_TYPE_BY_CODE[documento.TipoDocumento];
	if (documentType === undefined) {
		throw new Error(`unrecognised TipoDocumento: ${documento.TipoDocumento}`);
	}
	if (documento.ImportoTotaleDocumento === undefined) {
		throw new Error('DatiGeneraliDocumento is missing ImportoTotaleDocumento');
	}

	const taxSummary = body.DatiBeniServizi.DatiRiepilogo.map(mapTaxSummary);

	return {
		number: documento.Numero,
		issueDate: documento.Data,
		documentType,
		currency: documento.Divisa,
		supplier: mapSupplier(header.CedentePrestatore),
		customer: mapCustomer(header.CessionarioCommittente),
		lines: body.DatiBeniServizi.DettaglioLinee.map(mapLine),
		taxSummary,
		taxableAmount: sumMinorUnits(taxSummary.map((block) => block.taxableAmount)),
		taxAmount: sumMinorUnits(taxSummary.map((block) => block.taxAmount)),
		total: decimalStringToMinorUnits(documento.ImportoTotaleDocumento),
		stampDuty:
			documento.DatiBollo !== undefined
				? decimalStringToMinorUnits(documento.DatiBollo.ImportoBollo)
				: undefined,
		socialSecurityCharges: (documento.DatiCassaPrevidenziale ?? []).map(mapSocialCharge),
		paymentTerms: (body.DatiPagamento ?? []).map(mapPaymentTerms),
		transmission: {
			transmitterId: fiscalIdString(header.DatiTrasmissione.IdTrasmittente),
			progressiveNumber: header.DatiTrasmissione.ProgressivoInvio
		}
	};
}

/** Maps a parsed `FatturaElettronica` root to one `Invoice` per
 * `FatturaElettronicaBody` it carries, in document order. The XSD allows a
 * root to carry more than one body — a batch (`lotto`) of several
 * invoices transmitted together in one file, all sharing the same
 * `FatturaElettronicaHeader` — and #101 requires every one of them to
 * come back, not just the first, so this maps the whole array rather than
 * asserting there is exactly one body. */
export function mapFatturaPaToInvoices(root: RawFatturaElettronica): Invoice[] {
	return root.FatturaElettronicaBody.map((body) => mapBody(root.FatturaElettronicaHeader, body));
}
