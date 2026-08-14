import { addMinorUnits, NO_MINOR_UNITS, type MinorUnits } from '$lib/money';
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
 * One payment (#212): whatever `repositories/invoice.ts`'s `payment`
 * rows carry, reduced to what balance computation needs.
 */
export interface InvoicePayment {
	readonly amount: MinorUnits;
	readonly date: string;
}

/**
 * An invoice's paid state, *derived* from `total` and every payment
 * recorded against it (#212) — never stored as a single date the way
 * `invoice.paid_on` used to be, so a client who pays half is a second
 * row away from a client who pays the rest, not an unrepresentable
 * state. `settled` is `paid >= total`: an overpayment still settles,
 * exactly like an exact payment. `settledOn` is the date, walking
 * `payments` oldest first, at which the running sum first reached
 * `total` — `null` while any balance remains, so every caller that used
 * to branch on "is `invoice.paid_on` set" branches on "is `settledOn`
 * non-null" instead, with the identical result for an invoice paid in
 * one go.
 */
export interface InvoiceBalance {
	readonly paid: MinorUnits;
	readonly remaining: MinorUnits;
	readonly settled: boolean;
	readonly settledOn: string | null;
}

export function computeInvoiceBalance(
	total: MinorUnits,
	payments: readonly InvoicePayment[]
): InvoiceBalance {
	const ordered = [...payments].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
	let paid = NO_MINOR_UNITS;
	let settledOn: string | null = null;
	for (const payment of ordered) {
		paid = addMinorUnits(paid, payment.amount);
		if (settledOn === null && paid >= total) settledOn = payment.date;
	}
	const remaining = Math.max(total - paid, 0) as MinorUnits;
	return { paid, remaining, settled: paid >= total, settledOn };
}

/**
 * An invoice is overdue the instant its due date has passed with no
 * payment recorded — derived here on every read, never a stored flag a
 * batch job would have to refresh (#27's central acceptance bullet). A due
 * date that is today is not yet overdue: "past its due date" means
 * strictly after it. `settledOn` is {@link InvoiceBalance.settledOn}
 * (#212) — a partly paid invoice (`settledOn` still `null`) is exactly as
 * overdue as one nobody has paid anything against yet; only full
 * settlement takes it off this list.
 */
export function isOverdue(
	dueDate: string,
	settledOn: string | null,
	today: Date = new Date()
): boolean {
	return settledOn === null && daysLate(dueDate, today) > 0;
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
