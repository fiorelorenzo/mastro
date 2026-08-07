// Edge cases the one full fixture in `adapter.test.ts` cannot exercise
// without becoming several near-duplicate multi-hundred-line documents.
// These build the parsed-XML shape by hand instead — `map.ts` is a pure
// function of that shape, so a hand-built object is exactly as valid a
// case as one that came from real XML.
import { expect, test } from 'vitest';
import { mapFatturaPaToInvoice } from './map';
import type { RawFatturaElettronica } from './xml';

function baseRoot(): RawFatturaElettronica {
	return {
		'@_versione': 'FPR12',
		FatturaElettronicaHeader: {
			DatiTrasmissione: {
				IdTrasmittente: { IdPaese: 'IT', IdCodice: '11122233344' },
				ProgressivoInvio: '1',
				FormatoTrasmissione: 'FPR12'
			},
			CedentePrestatore: {
				DatiAnagrafici: {
					IdFiscaleIVA: { IdPaese: 'IT', IdCodice: '01234567890' },
					Anagrafica: { Denominazione: 'Test Supplier' }
				},
				Sede: { Indirizzo: 'Via Test 1', CAP: '00100', Comune: 'Roma' }
			},
			CessionarioCommittente: {
				DatiAnagrafici: {
					IdFiscaleIVA: { IdPaese: 'IT', IdCodice: '09876543210' },
					Anagrafica: { Denominazione: 'Test Customer' }
				},
				Sede: { Indirizzo: 'Via Test 2', CAP: '00200', Comune: 'Milano' }
			}
		},
		FatturaElettronicaBody: [
			{
				DatiGenerali: {
					DatiGeneraliDocumento: {
						TipoDocumento: 'TD01',
						Divisa: 'EUR',
						Data: '2026-01-01',
						Numero: '1',
						ImportoTotaleDocumento: '122.00'
					}
				},
				DatiBeniServizi: {
					DettaglioLinee: [
						{
							Descrizione: 'Line',
							PrezzoUnitario: '100.00',
							PrezzoTotale: '100.00',
							AliquotaIVA: '22.00'
						}
					],
					DatiRiepilogo: [{ AliquotaIVA: '22.00', ImponibileImporto: '100.00', Imposta: '22.00' }]
				}
			}
		]
	};
}

test('the common case: a company customer identified by IdFiscaleIVA', () => {
	const invoice = mapFatturaPaToInvoice(baseRoot());
	expect(invoice.number).toBe('1');
	expect(invoice.issueDate).toBe('2026-01-01');
	expect(invoice.documentType).toBe('invoice');
	expect(invoice.currency).toBe('EUR');
	expect(invoice.supplier.taxId).toBe('IT01234567890');
	expect(invoice.customer).toMatchObject({ taxId: 'IT09876543210', legalName: 'Test Customer' });
	expect(invoice.total).toBe(12200);
	expect(invoice.transmission).toEqual({ transmitterId: 'IT11122233344', progressiveNumber: '1' });
});

test('an individual customer identified only by CodiceFiscale maps using the fiscal code as taxId', () => {
	const root = baseRoot();
	root.FatturaElettronicaHeader.CessionarioCommittente.DatiAnagrafici = {
		CodiceFiscale: 'RSSMRA80A01H501U',
		Anagrafica: { Nome: 'Mario', Cognome: 'Rossi' }
	};
	const invoice = mapFatturaPaToInvoice(root);
	expect(invoice.customer.taxId).toBe('RSSMRA80A01H501U');
	expect(invoice.customer.legalName).toBe('Mario Rossi');
	expect(invoice.customer.nationalIdentifier).toBeUndefined();
});

test('a customer with neither IdFiscaleIVA nor CodiceFiscale is rejected rather than mapped with a blank id', () => {
	const root = baseRoot();
	root.FatturaElettronicaHeader.CessionarioCommittente.DatiAnagrafici = {
		Anagrafica: { Denominazione: 'Nobody' }
	};
	expect(() => mapFatturaPaToInvoice(root)).toThrow(/IdFiscaleIVA nor CodiceFiscale/);
});

test('an unrecognised TipoDocumento is rejected rather than guessed', () => {
	const root = baseRoot();
	root.FatturaElettronicaBody[0].DatiGenerali.DatiGeneraliDocumento.TipoDocumento = 'TD99';
	expect(() => mapFatturaPaToInvoice(root)).toThrow(/unrecognised TipoDocumento/);
});

test('a document missing ImportoTotaleDocumento is rejected rather than deriving a total', () => {
	const root = baseRoot();
	root.FatturaElettronicaBody[0].DatiGenerali.DatiGeneraliDocumento = {
		TipoDocumento: 'TD01',
		Divisa: 'EUR',
		Data: '2026-01-01',
		Numero: '1'
	};
	expect(() => mapFatturaPaToInvoice(root)).toThrow(/ImportoTotaleDocumento/);
});

test('a batch file with more than one FatturaElettronicaBody is rejected rather than parsing only the first', () => {
	const root = baseRoot();
	root.FatturaElettronicaBody = [root.FatturaElettronicaBody[0], root.FatturaElettronicaBody[0]];
	expect(() => mapFatturaPaToInvoice(root)).toThrow(/FatturaElettronicaBody/);
});

test('a payment instalment without an explicit due date is rejected rather than one being computed', () => {
	const root = baseRoot();
	root.FatturaElettronicaBody[0].DatiPagamento = [
		{
			CondizioniPagamento: 'TP02',
			DettaglioPagamento: [{ ModalitaPagamento: 'MP05', ImportoPagamento: '122.00' }]
		}
	];
	expect(() => mapFatturaPaToInvoice(root)).toThrow(/DataScadenzaPagamento/);
});

test('every payment-terms block keeps its own condition code and instalments', () => {
	const root = baseRoot();
	root.FatturaElettronicaBody[0].DatiPagamento = [
		{
			CondizioniPagamento: 'TP01',
			DettaglioPagamento: [
				{
					ModalitaPagamento: 'MP05',
					DataScadenzaPagamento: '2026-02-01',
					ImportoPagamento: '61.00',
					IBAN: 'IT60X0542811101000000123456'
				}
			]
		},
		{
			CondizioniPagamento: 'TP03',
			DettaglioPagamento: [
				{
					ModalitaPagamento: 'MP08',
					DataScadenzaPagamento: '2026-01-15',
					ImportoPagamento: '61.00'
				}
			]
		}
	];
	const invoice = mapFatturaPaToInvoice(root);
	expect(invoice.paymentTerms).toEqual([
		{
			conditionCode: 'TP01',
			installments: [
				{ dueDate: '2026-02-01', amount: 6100, method: 'MP05', iban: 'IT60X0542811101000000123456' }
			]
		},
		{
			conditionCode: 'TP03',
			installments: [{ dueDate: '2026-01-15', amount: 6100, method: 'MP08', iban: undefined }]
		}
	]);
});

test('stamp duty and the social charge are absent, not defaulted to zero, when the document carries none', () => {
	const invoice = mapFatturaPaToInvoice(baseRoot());
	expect(invoice.stampDuty).toBeUndefined();
	expect(invoice.socialSecurityCharges).toEqual([]);
});

test('stamp duty and the social charge survive when the document carries them', () => {
	const root = baseRoot();
	root.FatturaElettronicaBody[0].DatiGenerali.DatiGeneraliDocumento.DatiBollo = {
		ImportoBollo: '2.00'
	};
	root.FatturaElettronicaBody[0].DatiGenerali.DatiGeneraliDocumento.DatiCassaPrevidenziale = [
		{
			TipoCassa: 'TC22',
			AlCassa: '4.00',
			ImportoContributoCassa: '4.00',
			ImponibileCassa: '100.00',
			AliquotaIVA: '22.00'
		}
	];
	const invoice = mapFatturaPaToInvoice(root);
	expect(invoice.stampDuty).toBe(200);
	expect(invoice.socialSecurityCharges).toEqual([
		{ fundCode: 'TC22', rate: 4, amount: 400, taxableAmount: 10000, taxRateOnCharge: 22 }
	]);
});

test('taxableAmount and taxAmount sum every tax summary block, for a mixed-rate invoice', () => {
	const root = baseRoot();
	root.FatturaElettronicaBody[0].DatiBeniServizi.DatiRiepilogo = [
		{ AliquotaIVA: '22.00', ImponibileImporto: '100.00', Imposta: '22.00' },
		{
			AliquotaIVA: '0.00',
			Natura: 'N2',
			ImponibileImporto: '40.00',
			Imposta: '0.00',
			RiferimentoNormativo: 'Art. 1'
		}
	];
	const invoice = mapFatturaPaToInvoice(root);
	expect(invoice.taxableAmount).toBe(14000);
	expect(invoice.taxAmount).toBe(2200);
	expect(invoice.taxSummary).toHaveLength(2);
	expect(invoice.taxSummary[1].statutoryReference).toEqual({
		kind: 'legal-text',
		language: 'it',
		text: 'Art. 1'
	});
});
