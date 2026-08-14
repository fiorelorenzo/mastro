import type { PaymentTerms } from '$lib/server/db/schema/contract';
import { computeDueDate } from './contract';

/**
 * Where an invoice's due date came from: read verbatim off the document, or
 * worked out here from the contract's payment terms because the document
 * did not carry one. #26 requires this to be visible to the reader, not
 * just to whoever wrote the insert — it is the `due_date_source` column on
 * `invoice`, never a comment.
 */
export type InvoiceDueDateSource = 'document' | 'computed';

/**
 * Resolves an invoice's due date: `suppliedDueDate` verbatim when present
 * (an empty string counts as absent — a blank form field, not a date), or
 * `computeDueDate` against the contract's own `paymentTerms` otherwise.
 * `computeDueDate` already exists and is not reimplemented here (#18/#26).
 */
export function resolveDueDate(
	terms: PaymentTerms,
	issueDate: string,
	suppliedDueDate: string | null
): { dueDate: string; source: InvoiceDueDateSource } {
	if (suppliedDueDate) return { dueDate: suppliedDueDate, source: 'document' };
	const due = computeDueDate(terms, new Date(`${issueDate}T00:00:00Z`));
	return { dueDate: due.toISOString().slice(0, 10), source: 'computed' };
}

/**
 * Calendar days between `dueDate` and `today`, at UTC midnight so the
 * result does not depend on the server's local timezone (same convention
 * as `computeDueDate`). Positive once the due date has passed, zero on the
 * due date itself, negative before it. This is never a stored column
 * (#27): every caller recomputes it against the current instant, so an
 * ageing view is correct on read even if nothing has run recently.
 */
export function daysLate(dueDate: string, today: Date = new Date()): number {
	const due = new Date(`${dueDate}T00:00:00Z`);
	const dueMidnight = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
	const todayMidnight = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
	return Math.round((todayMidnight - dueMidnight) / 86_400_000);
}

/**
 * An invoice is overdue the instant its due date has passed with no
 * payment recorded — derived here on every read, never a stored flag a
 * batch job would have to refresh (#27's central acceptance bullet). A due
 * date that is today is not yet overdue: "past its due date" means
 * strictly after it.
 */
export function isOverdue(
	dueDate: string,
	paidOn: string | null,
	today: Date = new Date()
): boolean {
	return paidOn === null && daysLate(dueDate, today) > 0;
}

/**
 * Which of SdI's three delivery paths an invoice would actually take
 * (#259). `sdiCode` (`CodiceDestinatario`) wins when the client has one —
 * SdI resolves it over `PECDestinatario` whenever both are on file. Falls
 * back to `pecAddress` next, and to SdI's own reserved-area default,
 * `'0000000'`, when neither is set: legally valid (SdI parks the file in
 * the client's own "area riservata" and the invoice still counts as
 * issued) but silent — the self-hoster has to notify the client
 * out-of-band, which is why this is a named case rather than an invisible
 * default folded into `'sdi_code'`. A discriminated union, not a
 * `{case, sdiCode, pecAddress}` triple with the other two `null`: a
 * reader (and the template) only ever needs the field the resolved case
 * actually carries.
 */
export type InvoiceRouting =
	| { readonly case: 'sdi_code'; readonly sdiCode: string }
	| { readonly case: 'pec'; readonly pecAddress: string }
	| { readonly case: 'reserved_area' };

export function resolveInvoiceRouting(client: {
	readonly sdiCode: string | null;
	readonly pecAddress: string | null;
}): InvoiceRouting {
	if (client.sdiCode) return { case: 'sdi_code', sdiCode: client.sdiCode };
	if (client.pecAddress) return { case: 'pec', pecAddress: client.pecAddress };
	return { case: 'reserved_area' };
}
