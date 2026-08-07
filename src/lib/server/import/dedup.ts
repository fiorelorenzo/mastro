// The natural-key comparator the epic's rule 1 asks for: "dedup on the
// natural key (supplier tax id, number, year) plus the file hash." #47
// (last wave) used `naturalInvoiceKey` only within one scan, since the
// `invoice` table did not exist yet to check history against. #26 built
// that table and #44 is what actually checks against it: `review.ts`
// seeds its lookup with every `ExistingInvoiceRecord` already in the
// database (one per persisted invoice, carrying every document hash ever
// attached to it — the structured original and any PDF filed alongside
// it) before folding in whatever the current batch adds, so a same-batch
// repeat and a repeat of a past import are recognised by the identical
// comparator, never two.
//
// The file hash is what turns "same natural key" into "same file" versus
// "same invoice number, different bytes": an unchanged re-export hashes
// identically and is silently already present; a genuine re-issue keeps
// the number but changes the bytes, and `review.ts` surfaces that as a
// conflict rather than merging it into the existing record.

import { normalizedTaxId } from './direction';
import type { Invoice } from './invoice';

/** One invoice already on record, as far as dedup needs to know about it:
 * enough to compute its natural key (`number`/`issueDate` — the supplier
 * is always the account holder, since only outgoing invoices are ever
 * persisted) and every content hash currently attached to it, structured
 * document and PDF attachments alike. */
export interface ExistingInvoiceRecord {
	readonly id: string;
	readonly number: string;
	/** ISO date. */
	readonly issueDate: string;
	readonly hashes: readonly string[];
}

/** Only ever reads `supplier.taxId`, `number` and `issueDate` — accepting
 * a bare `{ taxId }` for `supplier` (rather than the full `InvoiceParty`
 * `Pick<Invoice, 'supplier'>` would demand) lets a caller build the same
 * key from a persisted `invoice` row, which never stored the supplier's
 * full identity in the first place (it is always the account holder, by
 * construction — only an outgoing invoice is ever persisted). */
export function naturalInvoiceKey(invoice: {
	readonly supplier: Pick<Invoice['supplier'], 'taxId'>;
	readonly number: Invoice['number'];
	readonly issueDate: Invoice['issueDate'];
}): string {
	const year = invoice.issueDate.slice(0, 4);
	return `${normalizedTaxId(invoice.supplier.taxId)}|${invoice.number.trim().toUpperCase()}|${year}`;
}
