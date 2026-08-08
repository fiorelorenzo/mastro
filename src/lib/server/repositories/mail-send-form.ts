import * as m from '$lib/paraglide/messages';
import { decimalStringToMinorUnits } from '$lib/server/import/decimal';
import { NO_MINOR_UNITS, type MinorUnits } from '$lib/money';
import type { EmailTemplateContext } from '$lib/server/mail/render';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type MailSendFormValues = {
	periodFrom: string;
	periodTo: string;
	invoiceNumber: string;
	amount: string;
	dueDate: string;
	to: string;
};

export type MailSendFormResult =
	| {
			ok: true;
			period: { from: string; to: string };
			invoice: EmailTemplateContext['invoice'] & { currency: string };
			to: string[];
			values: MailSendFormValues;
	  }
	| { ok: false; errors: Record<string, string>; values: MailSendFormValues };

/**
 * Parses the send screen's period, manually-entered invoice figures and
 * recipient list. The invoice fields are a stand-in for #26's `invoice`
 * table, which does not exist this wave (see the epic and #70's PR
 * description): once it does, this form's three invoice inputs go away
 * and this function reads the same figures off a persisted invoice row
 * instead.
 */
export function parseMailSendForm(formData: FormData, currency: string): MailSendFormResult {
	const errors: Record<string, string> = {};
	const string = (key: string) => String(formData.get(key) ?? '').trim();

	const periodFrom = string('periodFrom');
	const periodTo = string('periodTo');
	if (!periodFrom || !periodTo) {
		errors.period = m.mail_send_validation_period_required();
	} else if (periodTo < periodFrom) {
		errors.period = m.mail_send_validation_period_invalid();
	}

	const invoiceNumber = string('invoiceNumber');
	if (!invoiceNumber) errors.invoiceNumber = m.mail_send_validation_invoice_number_required();

	const amountRaw = string('amount');
	let amountMinorUnits: MinorUnits = NO_MINOR_UNITS;
	try {
		if (!amountRaw) throw new Error('blank');
		amountMinorUnits = decimalStringToMinorUnits(amountRaw);
	} catch {
		errors.amount = m.mail_send_validation_amount_invalid();
	}

	const dueDate = string('dueDate');
	if (!dueDate) errors.dueDate = m.mail_send_validation_due_date_required();

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

	const values: MailSendFormValues = {
		periodFrom,
		periodTo,
		invoiceNumber,
		amount: amountRaw,
		dueDate,
		to: toRaw
	};

	if (Object.keys(errors).length > 0) return { ok: false, errors, values };

	return {
		ok: true,
		period: { from: periodFrom, to: periodTo },
		invoice: { number: invoiceNumber, total: amountMinorUnits, currency, dueDate },
		to,
		values
	};
}
