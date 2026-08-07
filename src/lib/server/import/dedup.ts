// Same-batch dedup (#47's "already present" bucket), an honest subset of
// the natural-key dedup the epic (#8) asks for and #44 will actually build.
//
// The epic's rule 1 is "dedup on the natural key (supplier tax id, number,
// year) plus the file hash", checked against every invoice ever imported.
// That needs the `invoice` table, which this wave deliberately does not
// create (see the PR description) — `feat/invoices-payments` owns it, and
// #44 is next wave's issue for persisting an import and deduping against
// history. What this file gives #47 today is the same natural-key
// comparator applied only *within one scan*: two files in the same folder
// pick that describe the same invoice (a duplicate export, the same file
// copied twice) collapse to one "recognised" plus one "already present",
// instead of two separate proposals or two counted invoices.
//
// `naturalInvoiceKey` is exported, not inlined into review.ts, precisely so
// #44 can reuse this exact comparator against the persisted table instead
// of reimplementing it — the day #44 lands, `review.ts`'s in-batch `Map`
// becomes a database lookup using the same key, and nothing here needs to
// change shape.

import { normalizedTaxId } from './direction';
import type { Invoice } from './invoice';

export function naturalInvoiceKey(
	invoice: Pick<Invoice, 'supplier' | 'number' | 'issueDate'>
): string {
	const year = invoice.issueDate.slice(0, 4);
	return `${normalizedTaxId(invoice.supplier.taxId)}|${invoice.number.trim().toUpperCase()}|${year}`;
}
