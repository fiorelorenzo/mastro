// Placeholder substitution against real data (#71). Rendering always uses
// the interface's active locale (`$lib/i18n/format.ts`), the same
// simplification #69 (per-contract template language, out of scope this
// wave) names explicitly — a contract that needs its templates in a fixed
// language regardless of who is signed in needs that issue done first.
import { formatAmount, formatDate, formatDays } from '$lib/i18n/format';
import type { EmailTemplatePlaceholder } from '$lib/server/db/schema';
import type { Invoice } from '$lib/server/import/invoice';
import type { Register } from '$lib/server/register/types';
import { substitutePlaceholders } from './placeholders';

/**
 * What a template renders against. `invoice` only needs the handful of
 * fields the placeholder list actually reads, spelled out against the
 * neutral `Invoice` shape `src/lib/server/import/invoice.ts` already
 * defines — #26 turns that shape into the persisted `invoice` table this
 * wave, so a caller here supplies one by hand (a manual compose, or a
 * test) until a persisted row exists to read one from. `register` is the
 * day register for the same period (#70): `day_list`/`day_total`
 * substitute from its entries, never from a second, independent query.
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
};

function placeholderValues(
	context: EmailTemplateContext
): Readonly<Record<EmailTemplatePlaceholder, string>> {
	return {
		invoice_number: context.invoice.number,
		period: `${formatDate(context.period.from)} – ${formatDate(context.period.to)}`,
		amount: formatAmount(context.invoice.total / 100, context.invoice.currency),
		due_date: formatDate(context.invoice.dueDate),
		day_list: context.register.entries.map((entry) => formatDate(entry.date)).join(', '),
		day_total: formatDays(context.register.totalQuantity)
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
