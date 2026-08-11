// Placeholder substitution against real data (#71). Every figure below is
// formatted against `context.language` — the contract's own template
// language (#69) — explicitly, never against `$lib/i18n/format`'s default
// parameter (the signed-in operator's active interface locale): passing
// `language` is not optional, so there is no code path here that can fall
// back to whoever happens to be signed in when a message is composed.
import { daysLate } from '$lib/server/domain/invoice';
import { formatDate, formatDays, formatMinorUnits } from '$lib/i18n/format';
import type { ContractTemplateLanguage, EmailTemplatePlaceholder } from '$lib/server/db/schema';
import type { Invoice } from '$lib/server/import/invoice';
import type { Register } from '$lib/server/register/types';
import { substitutePlaceholders } from './placeholders';

/**
 * What a template renders against. `invoice` only needs the handful of
 * fields the placeholder list actually reads, spelled out against the
 * neutral `Invoice` shape `src/lib/server/import/invoice.ts` already
 * defines — the persisted `invoice` table (#26) satisfies this shape
 * directly, and a manual compose or a test can still supply one by hand.
 * `register` is the day register for the same period (#70): `day_list`/
 * `day_total` substitute from its entries, never from a second,
 * independent query. `language` is the contract's own template language
 * (#69, `contract.templateLanguage`) — every caller reads it off the same
 * contract the template belongs to, never off the active session.
 */
export type EmailTemplateContext = {
	invoice: Pick<Invoice, 'number' | 'total' | 'currency'> & {
		/** ISO date; the first instalment's due date, chosen by the caller
		 * from `Invoice.paymentTerms` since a document can carry more than
		 * one payment-terms block and only the caller knows which applies. */
		dueDate: string;
	};
	period: { from: string; to: string };
	register: Register;
	language: ContractTemplateLanguage;
	/**
	 * The date this context speaks as of, so `{{days_late}}` agrees with
	 * whatever the caller already decided "now" is. Optional, defaulting to
	 * the real clock, because a template rendered outside a dunning flow has
	 * no such date to offer.
	 */
	today?: Date;
};

function placeholderValues(
	context: EmailTemplateContext
): Readonly<Record<EmailTemplatePlaceholder, string>> {
	const { language } = context;
	return {
		invoice_number: context.invoice.number,
		period: `${formatDate(context.period.from, language)} – ${formatDate(context.period.to, language)}`,
		amount: formatMinorUnits(context.invoice.total, context.invoice.currency, language),
		due_date: formatDate(context.invoice.dueDate, language),
		day_list: context.register.entries.map((entry) => formatDate(entry.date, language)).join(', '),
		day_total: formatDays(context.register.totalQuantity, language),
		// Derived on read (#27's rule, reused rather than reimplemented):
		// never a stored figure that a batch job would have to refresh.
		// Negative or zero before the due date has passed — a dunning
		// template is only ever opened from an overdue invoice
		// (`src/lib/server/mail/dunning.ts`), so that case does not arise
		// in practice, but nothing here hides it if it did.
		days_late: formatDays(daysLate(context.invoice.dueDate, context.today), language)
	};
}

export type RenderedEmail = { subject: string; body: string };

/** Renders `template`'s subject and body against `context`. Every
 * placeholder a saved template can contain has a value here — validation
 * at save time (`findUnknownPlaceholders`) is what makes that total, not a
 * fallback in this function — so the result never carries a raw `{{...}}`
 * token (#71's acceptance). */
export function renderTemplate(
	template: { subject: string; body: string },
	context: EmailTemplateContext
): RenderedEmail {
	const values = placeholderValues(context);
	return {
		subject: substitutePlaceholders(template.subject, values),
		body: substitutePlaceholders(template.body, values)
	};
}
