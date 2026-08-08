// The neutral e-invoice shape (#41). Every structured invoice format an
// adapter parses maps onto this type — the fields are named after the
// concept an e-invoice standard generally carries (EN 16931 and its
// national extensions agree on most of these), never after one country's
// vocabulary, so a second adapter is a translation into this shape, not a
// change to it.
//
// This is a TypeScript type only: issue #26 turns it into the `invoice`
// table (and, most likely, one or two child tables — see the comment on
// `taxSummary` and `paymentTerms` below for why a single flat row does not
// fit everything a real document carries). `paid_on` is deliberately
// absent: epic #3 is explicit that no e-invoice format in any country
// carries it, so no adapter could ever fill it in — it is exclusively
// human input, entered after import.

import type { LegalText } from '$lib/legal/legal-text';
import type { MinorUnits } from '$lib/money';
import type { InvoiceDueDateSource } from '$lib/server/domain/invoice';

/**
 * What kind of document this is. Named after what the document does, not
 * after any country's document-type code — an adapter maps its own code
 * list onto this one.
 */
export type InvoiceDocumentType =
	| 'invoice'
	| 'advance_on_invoice'
	| 'advance_on_fee_note'
	| 'credit_note'
	| 'debit_note'
	| 'fee_note';

/**
 * One party to the invoice: the entity that issued it (the supplier) or
 * the one it was issued to (the customer). Mirrors the identity fields on
 * `db/schema/client.ts` deliberately, since both describe the same kind of
 * legal identity — but this type is not that table, and #26/#46 (client
 * matching) decide how the two line up, not this issue.
 */
export interface InvoiceParty {
	readonly legalName: string;
	/**
	 * The identifier direction detection (#45) and future dedup (#44) key
	 * on: whichever id the format guarantees every party carries. For
	 * FatturaPA this is `IdFiscaleIVA` (mandatory on the supplier), not
	 * `CodiceFiscale` (optional) — see the FatturaPA adapter for why.
	 */
	readonly taxId: string;
	/**
	 * A second, format-specific identifier when the document carries one
	 * (FatturaPA's optional `CodiceFiscale`, distinct from the VAT number
	 * for an individual Italian professional). Absent when the document
	 * has none.
	 */
	readonly nationalIdentifier?: string;
	/** ISO 3166-1 alpha-2. */
	readonly country: string;
	readonly addressLine1: string;
	readonly addressLine2?: string;
	readonly addressCity: string;
	readonly addressPostalCode: string;
	readonly addressRegion?: string;
}

/** One billed line. `taxRate` is the line's own VAT rate, which is what
 * ties it back to the `InvoiceTaxSummary` block it was folded into. */
export interface InvoiceLine {
	readonly description: string;
	readonly quantity: number;
	readonly unitPrice: MinorUnits;
	readonly amount: MinorUnits;
	readonly taxRate: number;
}

/**
 * One VAT-rate summary block. A real invoice can carry more than one —
 * mixed-rate invoices are routine — which is why this is an array on
 * `Invoice` rather than the single flat `taxTreatmentCode` /
 * `statutoryReference` pair epic #3 describes at the table level. #26
 * should either give `invoice` a child table for this (mirroring
 * `client`/`client_contact`) or, if it keeps the flat columns for the
 * common single-rate case, decide what happens to a document with more
 * than one block — dropping one silently is not an option.
 *
 * `statutoryReference` is a `LegalText`, not a translation key: it is the
 * literal wording the issuing document carries (FatturaPA's
 * `RiferimentoNormativo`), already in the language it was written in, and
 * AGENTS.md invariant 5 says it is never translated. This is a different
 * `LegalText` producer than a jurisdiction pack's `TaxTreatment` — the pack
 * declares what a code *should* say, this is what a specific document
 * actually *did* say, and the two can legitimately disagree (a supplier's
 * software using outdated wording), which is exactly why import keeps the
 * document's own text instead of substituting the pack's.
 */
export interface InvoiceTaxSummary {
	readonly taxRate: number;
	/** The tax treatment code, present only when the rate does not already
	 * say everything (FatturaPA's `Natura`, required whenever the rate is
	 * zero). */
	readonly taxTreatmentCode?: string;
	readonly statutoryReference?: LegalText;
	readonly taxableAmount: MinorUnits;
	readonly taxAmount: MinorUnits;
}

/**
 * A social-security fund contribution charged on the invoice (FatturaPA's
 * `DatiCassaPrevidenziale`) — the "social charge" #42 and epic #3 both
 * name. An invoice can carry more than one fund, though a single
 * consultant only ever pays into one; kept as an array so a second one
 * is a longer list, not a dropped field.
 */
export interface InvoiceSocialSecurityCharge {
	/** The fund's own code (FatturaPA's `TipoCassa`, e.g. `TC22` for
	 * INPS's Gestione Separata) — opaque here, a pack's label bundle is
	 * where it becomes a name a user reads. */
	readonly fundCode: string;
	readonly rate: number;
	readonly amount: MinorUnits;
	readonly taxableAmount?: MinorUnits;
	readonly taxRateOnCharge: number;
}

/** One instalment of a payment plan. `dueDate` is either read verbatim
 * from the document (FatturaPA's `DataScadenzaPagamento`) or computed here
 * from relative terms the document expresses instead (FatturaPA's
 * `DataRiferimentoTerminiPagamento` plus `GiorniTerminiPagamento`, #101) —
 * never invented from anything outside the document itself, the same
 * "read, don't invent" spirit #26's own `due_date_source` column on
 * `invoice` applies to a due date computed from the contract.
 * `dueDateSource` tells a reader which case produced this `dueDate`. */
export interface InvoicePaymentInstallment {
	/** ISO date. */
	readonly dueDate: string;
	readonly dueDateSource: InvoiceDueDateSource;
	readonly amount: MinorUnits;
	/** The document's own payment-method code (FatturaPA's
	 * `ModalitaPagamento`, e.g. `MP05` for a bank transfer) — opaque here,
	 * same reasoning as `fundCode` above. */
	readonly method: string;
	readonly iban?: string;
}

/** One payment-terms block: a condition code plus the instalments it
 * governs. FatturaPA allows more than one block (`DatiPagamento` occurs
 * 0..N times) when a document mixes payment conditions; kept as an array
 * on `Invoice` for the same reason as `taxSummary`. */
export interface InvoicePaymentTerms {
	/** The document's own condition code (FatturaPA's
	 * `CondizioniPagamento`, e.g. `TP02` for payment in full). */
	readonly conditionCode: string;
	readonly installments: readonly InvoicePaymentInstallment[];
}

/**
 * Who actually sent this document to the national exchange system, and
 * that transmission's own sequence number — useful for dedup (#44). This
 * is deliberately not where direction detection (#45) looks: when an
 * invoicing service files on the account holder's behalf, `transmitterId`
 * is the *service*, and the account holder appears only as `supplier`.
 * Reading this field for direction would misclassify every invoice a
 * service transmits as incoming.
 */
export interface InvoiceTransmission {
	readonly transmitterId: string;
	readonly progressiveNumber: string;
}

export interface Invoice {
	readonly number: string;
	/** ISO date. */
	readonly issueDate: string;
	readonly documentType: InvoiceDocumentType;
	/** ISO 4217. */
	readonly currency: string;
	readonly supplier: InvoiceParty;
	readonly customer: InvoiceParty;
	readonly lines: readonly InvoiceLine[];
	readonly taxSummary: readonly InvoiceTaxSummary[];
	/** Sum of `taxSummary[].taxableAmount`, kept as its own field because
	 * epic #3 names it at the invoice level. */
	readonly taxableAmount: MinorUnits;
	/** Sum of `taxSummary[].taxAmount`. */
	readonly taxAmount: MinorUnits;
	/** The document's own stated total, never derived by summing the
	 * fields above — a document is free to round or add charges this type
	 * does not model, and the total it declares is the one that must
	 * reconcile with what was actually paid. */
	readonly total: MinorUnits;
	/** Stamp duty (FatturaPA's `ImportoBollo`), absent when the document
	 * carries none. Never dropped when present — see #42. */
	readonly stampDuty?: MinorUnits;
	readonly socialSecurityCharges: readonly InvoiceSocialSecurityCharge[];
	readonly paymentTerms: readonly InvoicePaymentTerms[];
	readonly transmission: InvoiceTransmission;
}
