// Builds the manual compose screen's context off a real, persisted invoice
// row (#218): the general template-send screen used to make a human
// retype the invoice number, amount, due date and period by hand onto a
// real email to a real client — a stand-in for #26's `invoice` table
// while it did not exist. It exists now, so this reads the same figures
// the invoice picker on the compose screen lists (`listInvoicesForContract`),
// exactly the counterpart `dunning.ts` already is for the reminder screen
// (#73): same shape, same "no manual figure" rule, a different invariant
// (any of the contract's own invoices, not only an overdue one).
import { db, type DbExecutor } from '$lib/server/db';
import type { ContractTemplateLanguage } from '$lib/server/db/schema';
import type { MinorUnits } from '$lib/money';
import { buildRegister } from '$lib/server/repositories/register';
import type { EmailTemplateContext } from './render';

/** The handful of fields `buildManualSendContext` reads off a persisted
 * invoice row — exactly what `getInvoiceWithLines` returns satisfies this
 * shape directly, the same "read the real row, not a narrower copy of it"
 * choice `DunningInvoice` (`dunning.ts`) already makes. */
export type ManualSendInvoice = {
	readonly contractId: string;
	readonly number: string;
	readonly total: MinorUnits;
	readonly currency: string;
	readonly issueDate: string;
	readonly dueDate: string;
	readonly lines: readonly { readonly days: readonly { readonly date: string }[] }[];
};

/**
 * The period a manually composed cover note speaks to: every day this
 * invoice actually bills, oldest to newest — real dates read off its own
 * lines (`getInvoiceWithLines`), never a range typed by hand (#218). An
 * invoice with no linked days (an expense-only invoice, or one entered by
 * hand with no work units attached) has no such range: it collapses to
 * its own issue date, one real day rather than an invented one.
 */
export function manualSendPeriod(invoiceRow: Pick<ManualSendInvoice, 'issueDate' | 'lines'>): {
	from: string;
	to: string;
} {
	const dates = invoiceRow.lines.flatMap((line) => line.days.map((day) => day.date)).sort();
	if (dates.length === 0) return { from: invoiceRow.issueDate, to: invoiceRow.issueDate };
	return { from: dates[0], to: dates[dates.length - 1] };
}

/**
 * The context a manually composed cover note renders against, off a real,
 * persisted invoice row (#218). `language` is the contract's own template
 * language (#69) — the caller reads it off `template.contract`, never off
 * the active session, the same rule `buildDunningContext` follows.
 */
export async function buildManualSendContext(
	invoiceRow: ManualSendInvoice,
	language: ContractTemplateLanguage,
	executor: DbExecutor = db
): Promise<EmailTemplateContext> {
	const period = manualSendPeriod(invoiceRow);
	const register = await buildRegister(invoiceRow.contractId, period.from, period.to, executor);

	return {
		invoice: {
			number: invoiceRow.number,
			total: invoiceRow.total,
			currency: invoiceRow.currency,
			dueDate: invoiceRow.dueDate
		},
		period,
		register,
		language
	};
}
