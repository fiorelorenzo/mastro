// Turns FatturaPA 1.2 XML bytes into a validated object, without ever
// routing a monetary value through the parser's own number coercion —
// every leaf stays a string, so `../decimal.ts` is the only place a
// decimal amount is ever interpreted. Kept separate from `map.ts` (the
// actual field mapping) so parsing garbage bytes and mapping a
// well-formed document are two independently testable failure modes.
//
// The document is untrusted external input, so its shape is validated at
// this boundary with a schema (below) rather than assumed with a type
// cast: a document that is well-formed XML but does not actually match
// FatturaPA's structure comes back as `null`, the same signal as
// malformed XML, instead of a value that only turns out wrong three
// function calls into `map.ts`. The schema only covers the elements this
// adapter reads — the XSD allows many more, and Zod's default object
// parsing strips whatever it does not name, which is exactly "ignore the
// rest" for elements no field of `Invoice` needs.

import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { z } from 'zod';

/** Elements the schema allows to repeat. Forcing them to always parse as
 * arrays — even the single-element case — means the schema below never has
 * to accept "one element or an array of one", which `fast-xml-parser`
 * would otherwise produce depending on the document. */
const REPEATABLE_TAGS: Record<string, true> = {
	FatturaElettronicaBody: true,
	DettaglioLinee: true,
	DatiRiepilogo: true,
	DatiPagamento: true,
	DettaglioPagamento: true,
	DatiCassaPrevidenziale: true
};

const parser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: '@_',
	parseTagValue: false,
	parseAttributeValue: false,
	trimValues: true,
	isArray: (tagName) => REPEATABLE_TAGS[tagName] === true
});

const IdFiscaleSchema = z.object({
	IdPaese: z.string(),
	IdCodice: z.string()
});

const AnagraficaSchema = z.object({
	Denominazione: z.string().optional(),
	Nome: z.string().optional(),
	Cognome: z.string().optional()
});

const IndirizzoSchema = z.object({
	Indirizzo: z.string(),
	NumeroCivico: z.string().optional(),
	CAP: z.string(),
	Comune: z.string(),
	Provincia: z.string().optional(),
	Nazione: z.string().optional()
});

const DatiAnagraficiCedenteSchema = z.object({
	IdFiscaleIVA: IdFiscaleSchema,
	CodiceFiscale: z.string().optional(),
	Anagrafica: AnagraficaSchema
});

const CedentePrestatoreSchema = z.object({
	DatiAnagrafici: DatiAnagraficiCedenteSchema,
	Sede: IndirizzoSchema
});

const DatiAnagraficiCessionarioSchema = z.object({
	IdFiscaleIVA: IdFiscaleSchema.optional(),
	CodiceFiscale: z.string().optional(),
	Anagrafica: AnagraficaSchema
});

const CessionarioCommittenteSchema = z.object({
	DatiAnagrafici: DatiAnagraficiCessionarioSchema,
	Sede: IndirizzoSchema
});

const DatiTrasmissioneSchema = z.object({
	IdTrasmittente: IdFiscaleSchema,
	ProgressivoInvio: z.string(),
	FormatoTrasmissione: z.string()
});

const FatturaElettronicaHeaderSchema = z.object({
	DatiTrasmissione: DatiTrasmissioneSchema,
	CedentePrestatore: CedentePrestatoreSchema,
	CessionarioCommittente: CessionarioCommittenteSchema
});

const DatiBolloSchema = z.object({
	ImportoBollo: z.string()
});

const DatiCassaPrevidenzialeSchema = z.object({
	TipoCassa: z.string(),
	AlCassa: z.string(),
	ImportoContributoCassa: z.string(),
	ImponibileCassa: z.string().optional(),
	AliquotaIVA: z.string()
});

const DatiGeneraliDocumentoSchema = z.object({
	TipoDocumento: z.string(),
	Divisa: z.string(),
	Data: z.string(),
	Numero: z.string(),
	DatiBollo: DatiBolloSchema.optional(),
	DatiCassaPrevidenziale: z.array(DatiCassaPrevidenzialeSchema).optional(),
	ImportoTotaleDocumento: z.string().optional()
});

const DatiGeneraliSchema = z.object({
	DatiGeneraliDocumento: DatiGeneraliDocumentoSchema
});

const DettaglioLineeSchema = z.object({
	Descrizione: z.string(),
	Quantita: z.string().optional(),
	PrezzoUnitario: z.string(),
	PrezzoTotale: z.string(),
	AliquotaIVA: z.string()
});

const DatiRiepilogoSchema = z.object({
	AliquotaIVA: z.string(),
	Natura: z.string().optional(),
	ImponibileImporto: z.string(),
	Imposta: z.string(),
	RiferimentoNormativo: z.string().optional()
});

const DatiBeniServiziSchema = z.object({
	DettaglioLinee: z.array(DettaglioLineeSchema),
	DatiRiepilogo: z.array(DatiRiepilogoSchema)
});

const DettaglioPagamentoSchema = z.object({
	ModalitaPagamento: z.string(),
	DataScadenzaPagamento: z.string().optional(),
	ImportoPagamento: z.string(),
	IBAN: z.string().optional()
});

const DatiPagamentoSchema = z.object({
	CondizioniPagamento: z.string(),
	DettaglioPagamento: z.array(DettaglioPagamentoSchema)
});

const FatturaElettronicaBodySchema = z.object({
	DatiGenerali: DatiGeneraliSchema,
	DatiBeniServizi: DatiBeniServiziSchema,
	DatiPagamento: z.array(DatiPagamentoSchema).optional()
});

const FatturaElettronicaSchema = z.object({
	'@_versione': z.string(),
	FatturaElettronicaHeader: FatturaElettronicaHeaderSchema,
	FatturaElettronicaBody: z.array(FatturaElettronicaBodySchema)
});

export type RawIdFiscale = z.infer<typeof IdFiscaleSchema>;
export type RawIndirizzo = z.infer<typeof IndirizzoSchema>;
export type RawCedentePrestatore = z.infer<typeof CedentePrestatoreSchema>;
export type RawCessionarioCommittente = z.infer<typeof CessionarioCommittenteSchema>;
export type RawDatiCassaPrevidenziale = z.infer<typeof DatiCassaPrevidenzialeSchema>;
export type RawDettaglioLinee = z.infer<typeof DettaglioLineeSchema>;
export type RawDatiRiepilogo = z.infer<typeof DatiRiepilogoSchema>;
export type RawDatiPagamento = z.infer<typeof DatiPagamentoSchema>;
export type RawDatiGeneraliDocumento = z.infer<typeof DatiGeneraliDocumentoSchema>;
export type RawFatturaElettronicaBody = z.infer<typeof FatturaElettronicaBodySchema>;
export type RawFatturaElettronica = z.infer<typeof FatturaElettronicaSchema>;

/**
 * Parses `xml` and validates it against the fields this adapter reads,
 * returning the root `FatturaElettronica` element or `null` — for
 * malformed XML, a document with no such root, or one that does not match
 * the shape above. `null` is the one signal `detect` (in `adapter.ts`)
 * needs to decide it does not claim a file; a caller that wants to know
 * *why* a document was rejected calls this together with
 * `XMLValidator.validate` itself rather than getting an exception here.
 *
 * Tolerates a namespace prefix on the root tag (`ns2:FatturaElettronica`,
 * seen from some real senders) as well as the unprefixed form every
 * published example uses.
 */
export function tryParseFatturaElettronica(xml: string): RawFatturaElettronica | null {
	if (XMLValidator.validate(xml) !== true) return null;
	let parsed: unknown;
	try {
		parsed = parser.parse(xml);
	} catch {
		return null;
	}
	if (typeof parsed !== 'object' || parsed === null) return null;
	const rootKey = Object.keys(parsed).find(
		(key) => key === 'FatturaElettronica' || key.endsWith(':FatturaElettronica')
	);
	if (rootKey === undefined) return null;
	const root: unknown = Object.getOwnPropertyDescriptor(parsed, rootKey)?.value;
	const result = FatturaElettronicaSchema.safeParse(root);
	return result.success ? result.data : null;
}
