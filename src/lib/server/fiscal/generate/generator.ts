// The generation-direction sibling of `import/adapter.ts` (#41, #260).
// Where an `InvoiceFormatAdapter` turns a structured document's bytes into
// the neutral `Invoice` shape, an `InvoiceFormatGenerator` turns a
// `GeneratableInvoice` — the same neutral shape, read the other way round,
// off the ledger rather than off imported bytes — into a structured
// document's bytes. `id` is the same registry lookup key `generate.ts`
// resolves against a pack's `formats` list (`fiscal/pack.ts`), so a
// jurisdiction pack that advertises a format id for import (#42) advertises
// the very same id for generation, with no separate declaration.
//
// Nothing here may name a concrete format — see `generate.test.ts` for the
// standing proof, mirroring `import/importer.test.ts`.

import type { MinorUnits } from '$lib/money';
import type { InvoiceDocumentType } from '$lib/server/import/invoice';
import type { FiscalPack } from '../pack';

/** One billed line, read for generation. Unlike the import-direction
 * `InvoiceLine`, this carries no `taxTreatmentCode`/`taxRate` of its own:
 * #216 already established that one invoice takes exactly one resolved
 * tax treatment, document-wide, so a generator reads that treatment once,
 * from the pack passed to `generate` — never per line. */
export interface GeneratableInvoiceLine {
	readonly description: string;
	readonly quantity: number;
	readonly unitPrice: MinorUnits;
	readonly amount: MinorUnits;
}

/** A legal identity a generated document needs on either side: the
 * practice's own (`CedentePrestatore`) or the client's
 * (`CessionarioCommittente`). Mirrors `InvoiceParty` (`import/invoice.ts`)
 * deliberately — both describe the same kind of legal identity — but is
 * its own type: nothing here is parsed off a document, it is read
 * straight off `practice_profile`/`client`. */
export interface GeneratableParty {
	readonly legalName: string;
	/** The national tax id every legal entity carries (FatturaPA's
	 * `CodiceFiscale` for the flavour this format needs) — always
	 * present, mirroring `practice_profile.tax_id`'s own "every entity has
	 * one" reasoning. */
	readonly taxId: string;
	/** The VAT registration id, absent when this party has none —
	 * mirrors `practice_profile.vat_id`/`client.vat_id`, both nullable
	 * for the same reason. A format that requires one (FatturaPA's
	 * `CedentePrestatore.IdFiscaleIVA` is mandatory) is the generator's
	 * own business to enforce, not this type's. */
	readonly vatId: string | null;
	/** ISO 3166-1 alpha-2. */
	readonly country: string;
	readonly addressLine1: string;
	readonly addressLine2: string | null;
	readonly addressCity: string;
	readonly addressPostalCode: string;
	readonly addressRegion: string | null;
}

/** The client-side party plus the routing data only a customer carries
 * (#259) — SdI has nowhere to send a document addressed to the practice
 * itself. */
export interface GeneratableCustomer extends GeneratableParty {
	readonly sdiCode: string | null;
	readonly pecAddress: string | null;
}

/**
 * The neutral shape a generator reads (#260) — read off the ledger
 * (`invoice`, `invoice_line`, the contract's `client`), not parsed off any
 * document. Every monetary field is the invoice's own, already-computed
 * column: a generator never re-derives `taxableAmount`/`taxAmount`/`total`
 * from the lines, the same "trust what was actually recorded" choice
 * `getInvoiceWithLines` callers already make elsewhere.
 */
export interface GeneratableInvoice {
	readonly number: string;
	/** ISO date. */
	readonly issueDate: string;
	readonly documentType: InvoiceDocumentType;
	/** ISO 4217. */
	readonly currency: string;
	readonly taxableAmount: MinorUnits;
	readonly taxAmount: MinorUnits;
	readonly total: MinorUnits;
	/** `evaluateInvoiceCharges`'s `stampDuty`, already summed onto the
	 * invoice row — `null` when the pack's stamp-duty charge did not
	 * apply. */
	readonly stampDuty: MinorUnits | null;
	/** `evaluateInvoiceCharges`'s `socialCharge`, already summed onto the
	 * invoice row — `null` when the pack declares no social-security
	 * charge, or it did not apply. */
	readonly socialCharge: MinorUnits | null;
	/** ISO date. */
	readonly dueDate: string;
	/** Opaque, format-shaped payment-method code (`invoice.ts`'s own
	 * comment: "same treatment as `InvoicePaymentInstallment.method`") —
	 * `null` when the invoice carries none, which a generator reads as
	 * "say nothing about payment terms" rather than guessing one. */
	readonly paymentMethod: string | null;
	readonly iban: string | null;
	readonly lines: readonly GeneratableInvoiceLine[];
	readonly customer: GeneratableCustomer;
}

/** What `generate` hands back: the bytes plus enough to store and offer
 * them as a `document` (#260's acceptance) without the caller having to
 * know anything format-specific to do it. */
export interface GeneratedInvoiceDocument {
	readonly bytes: Uint8Array;
	readonly mime: string;
	readonly filename: string;
}

/**
 * A single structured invoice format's generation side. `id` matches an
 * entry in a jurisdiction pack's `formats` list, exactly like
 * `InvoiceFormatAdapter.id` — `generate.ts` resolves a generator only for
 * a format the active pack actually declares support for.
 */
export interface InvoiceFormatGenerator {
	readonly id: string;

	/**
	 * Renders `invoice` as this format's own structured document, using
	 * `practiceProfile` for the issuer block and `pack` for everything a
	 * jurisdiction pack already models (the tax-regime code, the default
	 * tax treatment, the statutory charges) — never anything the pack
	 * does not carry. Throws when a field this format legally requires is
	 * missing (an absent `practiceProfile.vatId`, most concretely) rather
	 * than emitting a document known to be invalid; there is no human in
	 * this path to notice a wrong or missing field either.
	 */
	generate(
		invoice: GeneratableInvoice,
		practiceProfile: GeneratableParty,
		pack: FiscalPack
	): GeneratedInvoiceDocument;
}
