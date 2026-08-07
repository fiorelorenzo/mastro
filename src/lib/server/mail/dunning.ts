// Builds the draft-reminder context for an overdue invoice (#73). Same
// engine as every other draft (`prepareEmail`/`dispatchEmail` in
// `send.ts`): this only assembles the `EmailTemplateContext` a dunning
// template renders against, straight off a real, persisted invoice. There
// is no scheduler here and none is added — #27 already derives "overdue"
// on read for the ageing table (`isOverdue`/`daysLate`,
// `src/lib/server/domain/invoice.ts`), and this reuses that derivation
// rather than a second one, at the instant a human opens the reminder
// screen. Dispatch always goes through the same `dispatchEmail` a manual
// send does — there is no automatic path for a dunning draft to opt into,
// so "nothing chases a client automatically" holds by construction, not
// by a flag that has to stay off.
import { isOverdue } from '$lib/server/domain/invoice';
import { db, type DbExecutor } from '$lib/server/db';
import type { ContractTemplateLanguage } from '$lib/server/db/schema';
import { buildRegister } from '$lib/server/repositories/register';
import type { EmailTemplateContext } from './render';

/** Thrown by `buildDunningContext` for an invoice that is not actually
 * overdue — unpaid but not yet past its due date, or already paid. A
 * dunning draft for either would misstate the ledger. */
export class InvoiceNotOverdueError extends Error {
	constructor(invoiceNumber: string) {
		super(
			`invoice ${invoiceNumber} is not overdue; a dunning draft only makes sense once its due date has passed with no payment recorded`
		);
		this.name = 'InvoiceNotOverdueError';
	}
}

export type DunningInvoice = {
	readonly contractId: string;
	readonly number: string;
	readonly total: number;
	readonly currency: string;
	readonly issueDate: string;
	readonly dueDate: string;
	readonly paidOn: string | null;
};

/**
 * Builds the context a dunning draft renders against, off a real,
 * persisted `invoice` row. `language` is the contract's own template
 * language (#69) — the caller reads it off `invoice.contract`, never off
 * the active session. `period`/`register` are the invoice's own billed
 * days (their real date range), the same "real data" standard as
 * `amount`/`dueDate`/`daysLate`: if a reminder template ever references
 * `{{day_list}}`/`{{day_total}}`/`{{period}}` they are as real as every
 * other placeholder, never a stand-in.
 */
export async function buildDunningContext(
	invoiceRow: DunningInvoice,
	language: ContractTemplateLanguage,
	executor: DbExecutor = db,
	today: Date = new Date()
): Promise<EmailTemplateContext> {
	if (!isOverdue(invoiceRow.dueDate, invoiceRow.paidOn, today)) {
		throw new InvoiceNotOverdueError(invoiceRow.number);
	}

	const period = { from: invoiceRow.issueDate, to: invoiceRow.dueDate };
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
