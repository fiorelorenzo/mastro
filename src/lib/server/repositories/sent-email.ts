// Reads back what `sent_email` already knows about a specific invoice
// (#230): the chase history the invoice detail page shows, and the
// duplicate check the dunning compose screen (`invoices/[id]/remind`)
// runs before a second reminder goes out for the same invoice with the
// same template. `sent_email.invoice_id` links only the sends that were
// actually about one invoice — every dunning send, and now the general
// compose screen's own invoice-linked cover note (#218) — never every
// send for the contract, which `sent_email.contract_id` already covers
// and nothing here duplicates.
import { and, desc, eq, gte } from 'drizzle-orm';
import { db, type DbExecutor } from '$lib/server/db';
import { emailTemplate, sentEmail } from '$lib/server/db/schema';

/** One past send about a given invoice — the invoice detail page's chase
 * history row (#230). */
export interface InvoiceChaseRow {
	readonly id: string;
	readonly sentAt: Date;
	readonly templateId: string;
	readonly templateName: string;
	readonly recipients: readonly string[];
}

/** Every email sent about `invoiceId`, most recent first (#230) — the
 * invoice detail page's chase history, whose own top row already answers
 * "when was this last chased and with which template". */
export async function listSentEmailsForInvoice(
	invoiceId: string,
	executor: DbExecutor = db
): Promise<InvoiceChaseRow[]> {
	return executor
		.select({
			id: sentEmail.id,
			sentAt: sentEmail.createdAt,
			templateId: sentEmail.emailTemplateId,
			templateName: emailTemplate.name,
			recipients: sentEmail.recipients
		})
		.from(sentEmail)
		.innerJoin(emailTemplate, eq(emailTemplate.id, sentEmail.emailTemplateId))
		.where(eq(sentEmail.invoiceId, invoiceId))
		.orderBy(desc(sentEmail.createdAt));
}

/**
 * The first instant of the UTC calendar month containing `date` — the
 * "period" a duplicate reminder is judged against (#230). A reminder
 * cadence has no period of its own the way a cover note's billed days do
 * (#218's `manualSendPeriod`): a calendar month is the smallest span
 * nothing else in the product already claims, and long enough that a
 * human re-opening the same overdue invoice a day later to fix a typo in
 * the recipient list is not itself flagged as a duplicate.
 */
export function chasePeriodStart(date: Date): Date {
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/** The most recent send of `templateId` against `invoiceId` since
 * `periodStart`, or `null` when this would be the first this period —
 * the dunning compose screen's "asks first" check (#230): a second send
 * of the same template for the same invoice inside one calendar month is
 * a duplicate until a human explicitly confirms it. */
export async function findChaseThisPeriod(
	invoiceId: string,
	templateId: string,
	periodStart: Date,
	executor: DbExecutor = db
): Promise<{ sentAt: Date } | null> {
	const [row] = await executor
		.select({ sentAt: sentEmail.createdAt })
		.from(sentEmail)
		.where(
			and(
				eq(sentEmail.invoiceId, invoiceId),
				eq(sentEmail.emailTemplateId, templateId),
				gte(sentEmail.createdAt, periodStart)
			)
		)
		.orderBy(desc(sentEmail.createdAt))
		.limit(1);
	return row ?? null;
}
