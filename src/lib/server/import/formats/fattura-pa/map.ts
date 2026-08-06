// Maps a parsed FatturaPA 1.2 document onto the neutral `Invoice` shape
// (#42). Pure: no I/O, so every case is a fixture and an assertion, no
// mocking required.

import { legalText } from '$lib/server/fiscal/label';
import { decimalStringToMinorUnits } from '../../decimal';
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
			if (dettaglio.DataScadenzaPagamento === undefined) {
				// The schema also allows expressing a due date as a relative
				// term (`GiorniTerminiPagamento` days after
				// `DataRiferimentoTerminiPagamento`). #42 requires the due
				// date to come from the document, never be recomputed, so a
				// document using only the relative form is not supported
				// here rather than silently deriving a date.
				throw new Error(
					'DettaglioPagamento has no DataScadenzaPagamento; relative payment terms are not supported'
				);
			}
			return {
				dueDate: dettaglio.DataScadenzaPagamento,
				amount: decimalStringToMinorUnits(dettaglio.ImportoPagamento),
				method: dettaglio.ModalitaPagamento,
				iban: dettaglio.IBAN
			};
		})
	};
}

/** Maps a single parsed `FatturaElettronica` root to an `Invoice`. Throws
 * on a well-formed document this adapter does not (yet) support — a batch
 * file carrying more than one `FatturaElettronicaBody`, or a document
 * omitting `ImportoTotaleDocumento` — rather than silently parsing part of
 * it. */
export function mapFatturaPaToInvoice(root: RawFatturaElettronica): Invoice {
	if (root.FatturaElettronicaBody.length !== 1) {
		throw new Error(
			`FatturaElettronica has ${root.FatturaElettronicaBody.length} FatturaElettronicaBody elements; only a single-invoice file is supported`
		);
	}
	const header = root.FatturaElettronicaHeader;
	const body = root.FatturaElettronicaBody[0];
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
		taxableAmount: taxSummary.reduce((sum, block) => sum + block.taxableAmount, 0),
		taxAmount: taxSummary.reduce((sum, block) => sum + block.taxAmount, 0),
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
