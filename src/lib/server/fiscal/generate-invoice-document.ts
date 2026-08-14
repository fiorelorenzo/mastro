// The only place that writes a generated invoice document (#260) —
// mirrors `import/persist.ts`'s role for the import direction: everything
// under `generate/` only proposes bytes, nothing reaches disk or the
// database until this module writes them. Maps the DB-level invoice row
// (`repositories/invoice.ts`'s `getInvoiceWithLines`) and the singleton
// `practice_profile` row onto the neutral shapes `generate/generate.ts`
// consumes, then archives the result as a `document`
// (`ownerType: 'invoice'`, `provenance: 'generated'`) per invariant 4: once
// it exists, the generated XML *is* a source document, not a re-derivable
// side effect.

import { db, type DbExecutor } from '$lib/server/db';
import type { document } from '$lib/server/db/schema';
import { storeDocument } from '$lib/server/repositories/document';
import type { MinorUnits } from '$lib/money';
import type { InvoiceDocumentType } from '$lib/server/import/invoice';
import type { FiscalPack } from './pack';
import { clientInvoicingGaps } from './client-invoicing-gaps';
import { generateInvoiceDocument } from './generate/generate';
import { defaultGeneratorRegistry } from './generate/registry';
import type {
	GeneratableCustomer,
	GeneratableInvoice,
	GeneratableParty
} from './generate/generator';

/** The identity fields this module needs off a party row — structurally
 * satisfied by both `practice_profile` and `client` (`db/schema`), so
 * either can be passed straight through with no adapter of its own. */
export interface PartyIdentityRow {
	readonly legalName: string;
	readonly taxId: string;
	readonly vatId: string | null;
	readonly country: string;
	readonly addressLine1: string;
	readonly addressLine2: string | null;
	readonly addressCity: string;
	readonly addressPostalCode: string;
	readonly addressRegion: string | null;
}

/** The fields this module needs off `getInvoiceWithLines`'s result —
 * named here rather than derived from that function's own return type, so
 * this module's contract is what a reader sees, not what happens to fall
 * out of a Drizzle relational query today. Structurally satisfied by the
 * real repository row: nothing here needs to import it. Deliberately
 * excludes `paidOn` — whether an invoice is paid is W7Payments' own
 * model (#260's assignment note) and has no bearing on what the document
 * itself says. */
export interface GeneratableInvoiceRow {
	readonly id: string;
	readonly contractId: string;
	readonly number: string;
	readonly issueDate: string;
	readonly documentType: InvoiceDocumentType;
	readonly currency: string;
	readonly taxableAmount: MinorUnits;
	readonly taxAmount: MinorUnits;
	readonly total: MinorUnits;
	readonly stampDuty: MinorUnits | null;
	readonly socialCharge: MinorUnits | null;
	readonly dueDate: string;
	readonly paymentMethod: string | null;
	readonly iban: string | null;
	readonly lines: readonly {
		readonly description: string;
		readonly quantity: number;
		readonly unitPrice: MinorUnits;
		readonly amount: MinorUnits;
	}[];
	readonly contract: {
		/** Nullable where `client` is nullable since migration 0056: a client
		 * needs only a legal name and a country. `assertInvoiceableClient`
		 * below is what turns that back into the complete party a document
		 * needs, refusing by name rather than emitting a blank field. */
		readonly client: Omit<
			PartyIdentityRow,
			'taxId' | 'addressLine1' | 'addressCity' | 'addressPostalCode'
		> & {
			readonly taxId: string | null;
			readonly addressLine1: string | null;
			readonly addressCity: string | null;
			readonly addressPostalCode: string | null;
			readonly sdiCode: string | null;
			readonly pecAddress: string | null;
		};
	};
}

export type StoredDocumentRow = typeof document.$inferSelect;

function toGeneratableParty(row: PartyIdentityRow): GeneratableParty {
	return {
		legalName: row.legalName,
		taxId: row.taxId,
		vatId: row.vatId,
		country: row.country,
		addressLine1: row.addressLine1,
		addressLine2: row.addressLine2,
		addressCity: row.addressCity,
		addressPostalCode: row.addressPostalCode,
		addressRegion: row.addressRegion
	};
}

/**
 * The last net, and deliberately not the first: `clientInvoicingGaps` is
 * what the screens read so a reviewer is told before clicking, and this is
 * what stops an incomplete client reaching the XML builder anyway. Throws
 * naming every missing field at once, because fixing them one refusal at a
 * time is four round trips through the client edit screen.
 */
export function toGeneratableCustomer(
	client: GeneratableInvoiceRow['contract']['client'],
	pack: Pick<FiscalPack, 'formats'>
): GeneratableCustomer {
	const gaps = clientInvoicingGaps(client, pack);
	if (gaps.length > 0) {
		throw new Error(
			`client ${JSON.stringify(client.legalName)} cannot be invoiced under this pack until ` +
				`${gaps.join(', ')} ${gaps.length === 1 ? 'is' : 'are'} filled in`
		);
	}
	return {
		...toGeneratableParty({
			...client,
			// Non-null by the check above, which named every one of them.
			taxId: client.taxId!,
			addressLine1: client.addressLine1!,
			addressCity: client.addressCity!,
			addressPostalCode: client.addressPostalCode!
		}),
		sdiCode: client.sdiCode,
		pecAddress: client.pecAddress
	};
}

export function toGeneratableInvoice(
	invoiceRow: GeneratableInvoiceRow,
	customer: GeneratableCustomer
): GeneratableInvoice {
	return {
		number: invoiceRow.number,
		issueDate: invoiceRow.issueDate,
		documentType: invoiceRow.documentType,
		currency: invoiceRow.currency,
		taxableAmount: invoiceRow.taxableAmount,
		taxAmount: invoiceRow.taxAmount,
		total: invoiceRow.total,
		stampDuty: invoiceRow.stampDuty,
		socialCharge: invoiceRow.socialCharge,
		dueDate: invoiceRow.dueDate,
		paymentMethod: invoiceRow.paymentMethod,
		iban: invoiceRow.iban,
		lines: invoiceRow.lines.map((line) => ({
			description: line.description,
			quantity: line.quantity,
			unitPrice: line.unitPrice,
			amount: line.amount
		})),
		customer
	};
}

export type GenerateAndStoreOutcome =
	| { readonly kind: 'unsupported' }
	| { readonly kind: 'stored'; readonly document: StoredDocumentRow; readonly filename: string };

/**
 * Generates `invoiceRow`'s document under `pack` and archives it. Returns
 * `{ kind: 'unsupported' }`, never a guessed document, when `pack`
 * declares no format this product ships a generator for (the generic
 * pack, most concretely) — the caller shows that as a visible "not
 * available for this jurisdiction" state, the same restraint
 * `resolveInvoiceRouting`'s callers already apply to routing.
 */
export async function generateAndStoreInvoiceDocument(
	invoiceRow: GeneratableInvoiceRow,
	practiceProfile: PartyIdentityRow,
	pack: FiscalPack,
	executor: DbExecutor = db
): Promise<GenerateAndStoreOutcome> {
	// Before the conversion, and before `generateInvoiceDocument` decides
	// whether this pack has a format at all: an instance on a pack with no
	// format reports no gaps, so it still returns `unsupported` rather than
	// throwing about fields its jurisdiction never asked for.
	const customer = toGeneratableCustomer(invoiceRow.contract.client, pack);
	const generated = generateInvoiceDocument(
		toGeneratableInvoice(invoiceRow, customer),
		toGeneratableParty(practiceProfile),
		pack,
		defaultGeneratorRegistry
	);
	if (!generated) return { kind: 'unsupported' };

	const documentRow = await storeDocument(
		{
			bytes: generated.bytes,
			mime: generated.mime,
			originalName: generated.filename,
			provenance: 'generated',
			contractId: invoiceRow.contractId,
			// Carries the same financial and personal detail as the invoice
			// itself and any imported original — same choice `import/persist.ts`
			// makes for both.
			confidential: true,
			ownerType: 'invoice',
			ownerId: invoiceRow.id
		},
		executor
	);
	return { kind: 'stored', document: documentRow, filename: generated.filename };
}
