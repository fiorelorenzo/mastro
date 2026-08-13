// Parses the general compose screen's submission (#218): which of the
// contract's own invoices this cover note is about, and who to send it
// to. The invoice itself is never typed in — it is a real, persisted row
// the human picks from a list (`listInvoicesForContract`), the same "read
// the real row, validate the choice against it" shape `dunning-form.ts`
// already uses for its own template picker. Before #218 this module also
// parsed a hand-typed invoice number, amount, due date and period: a
// stand-in for #26's `invoice` table while it did not exist. It exists
// now, so those three inputs are gone — see `src/lib/server/mail/
// compose.ts` for how a picked invoice becomes the figures a template
// renders against.
import * as m from '$lib/paraglide/messages';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type MailSendFormValues = { invoiceId: string; to: string };

export type MailSendFormResult =
	| { ok: true; invoiceId: string; to: string[]; values: MailSendFormValues }
	| { ok: false; errors: Record<string, string>; values: MailSendFormValues };

/**
 * Validates `invoiceId` against `invoices` — the contract's own invoices,
 * so a submission cannot name one belonging to another contract — and
 * `to` the same way every compose screen does.
 */
export function parseMailSendForm(
	formData: FormData,
	invoices: readonly { id: string }[]
): MailSendFormResult {
	const errors: Record<string, string> = {};
	const string = (key: string) => String(formData.get(key) ?? '').trim();

	const invoiceId = string('invoiceId');
	const invoice = invoices.find((candidate) => candidate.id === invoiceId);
	if (!invoice) errors.invoiceId = m.mail_send_validation_invoice_required();

	const toRaw = string('to');
	const to = toRaw
		.split(/[,\n]/)
		.map((address) => address.trim())
		.filter((address) => address.length > 0);
	if (to.length === 0) {
		errors.to = m.mail_send_validation_to_required();
	} else {
		const invalid = to.find((address) => !EMAIL_PATTERN.test(address));
		if (invalid) errors.to = m.mail_send_validation_to_invalid({ email: invalid });
	}

	const values: MailSendFormValues = { invoiceId, to: toRaw };

	if (Object.keys(errors).length > 0 || !invoice) return { ok: false, errors, values };

	return { ok: true, invoiceId: invoice.id, to, values };
}
