import type { PaymentTerms } from '$lib/server/db/schema/contract';

/**
 * The due date an invoice dated `invoiceDate` falls on, under a contract's
 * `payment_terms`.
 *
 * `net`: `days` calendar days after the invoice date.
 *
 * `day_of_month`: the `day`th of the month `monthOffset` months after the
 * invoice date's month (currently always 1 — "the following month"). A
 * `day` past the end of that month clamps to the month's last day (day 31
 * requested against a 30-day month lands on the 30th), rather than
 * overflowing into the month after. Dates are compared in UTC so the result
 * does not depend on the server's local timezone.
 */
export function computeDueDate(terms: PaymentTerms, invoiceDate: Date): Date {
	if (terms.kind === 'net') {
		const due = new Date(invoiceDate);
		due.setUTCDate(due.getUTCDate() + terms.days);
		return due;
	}

	const year = invoiceDate.getUTCFullYear();
	const targetMonth = invoiceDate.getUTCMonth() + terms.monthOffset;
	// Day 0 of the month after `targetMonth` is the last day of `targetMonth`;
	// `Date.UTC` normalises a month index outside 0-11 by rolling the year,
	// which is what carries `monthOffset` across a December -> January
	// boundary for free.
	const lastDayOfTargetMonth = new Date(Date.UTC(year, targetMonth + 1, 0)).getUTCDate();
	const day = Math.min(terms.day, lastDayOfTargetMonth);
	return new Date(Date.UTC(year, targetMonth, day));
}

/**
 * The date the refusal window for a `counterparty_option` renewal opens:
 * `renewalNoticeDays` before the current term's `endsOn`. `null` when
 * either is absent (renewal_type 'none' has neither, by the
 * `contract_renewal_notice_days_required` CHECK), so the caller cannot
 * apply this to a contract that does not renew.
 */
export function renewalWindowOpensOn(contract: {
	endsOn: string | null;
	renewalNoticeDays: number | null;
}): Date | null {
	if (contract.endsOn === null || contract.renewalNoticeDays === null) return null;
	const opensOn = new Date(`${contract.endsOn}T00:00:00Z`);
	opensOn.setUTCDate(opensOn.getUTCDate() - contract.renewalNoticeDays);
	return opensOn;
}
