import * as m from '$lib/paraglide/messages';
import { noticeChannel, type NoticeChannel } from '$lib/server/db/schema';
import type { ClientInput } from './client';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ClientFormValues = {
	legalName: string;
	taxId: string;
	vatId: string;
	country: string;
	addressLine1: string;
	addressLine2: string;
	addressCity: string;
	addressPostalCode: string;
	addressRegion: string;
	noticeChannel: string;
	sdiCode: string;
	pecAddress: string;
	contacts: { name: string; email: string; phone: string; role: string; canApprove: boolean }[];
};

export type ClientFormResult =
	| { ok: true; input: ClientInput; values: ClientFormValues }
	| { ok: false; errors: Record<string, string>; values: ClientFormValues };

/**
 * Parses and validates a client create/edit submission. Contact rows are
 * addressed as `contactName_0`, `contactEmail_0`, ... up to `contactCount`
 * (exclusive); a row with no name is a spare blank slot and is dropped
 * silently rather than reported as an error.
 */
export function parseClientForm(formData: FormData): ClientFormResult {
	const errors: Record<string, string> = {};
	const string = (key: string) => String(formData.get(key) ?? '').trim();

	const legalName = string('legalName');
	if (!legalName) errors.legalName = m.client_validation_legal_name_required();

	// Optional since migration 0056. What a client must have to be recorded
	// is a legal name and a country; a tax id, an address and a notice
	// channel are demanded by whatever needs them — `clientInvoicingGaps`
	// tells an invoice screen which are missing before it offers to
	// generate anything.
	const taxId = string('taxId');

	const vatId = string('vatId');

	const country = string('country').toUpperCase();
	if (!/^[A-Z]{2}$/.test(country)) errors.country = m.client_validation_country_invalid();

	// #259: FatturaPA's CodiceDestinatario, exactly 7 characters when
	// present — mirrors the DB's own `client_sdi_code_length` CHECK, so a
	// bad code never reaches it.
	const sdiCode = string('sdiCode').toUpperCase();
	if (sdiCode && sdiCode.length !== 7) errors.sdiCode = m.client_validation_sdi_code_invalid();

	// FatturaPA's PECDestinatario: a certified-mail address, same shape
	// check every other email field in this app applies (mirrors the DB's
	// `client_pec_address_is_email` CHECK).
	const pecAddress = string('pecAddress');
	if (pecAddress && !EMAIL_PATTERN.test(pecAddress)) {
		errors.pecAddress = m.client_validation_pec_address_invalid();
	}

	const addressLine1 = string('addressLine1');
	const addressLine2 = string('addressLine2');
	const addressCity = string('addressCity');
	const addressPostalCode = string('addressPostalCode');
	const addressRegion = string('addressRegion');

	// Blank is a legitimate answer — nobody has said yet which channel
	// carries legal weight for this client — but a value that is present
	// and not one of the enum's is still a mistake worth naming.
	const noticeChannelValue = string('noticeChannel');
	if (
		noticeChannelValue &&
		!noticeChannel.enumValues.includes(noticeChannelValue as NoticeChannel)
	) {
		errors.noticeChannel = m.client_validation_notice_channel_invalid();
	}

	const contactCount = Number(formData.get('contactCount') ?? 0);
	const contactValues: ClientFormValues['contacts'] = [];
	const contacts: ClientInput['contacts'] = [];
	for (let i = 0; i < contactCount; i++) {
		const name = string(`contactName_${i}`);
		const email = string(`contactEmail_${i}`);
		const phone = string(`contactPhone_${i}`);
		const role = string(`contactRole_${i}`);
		const canApprove = formData.get(`contactCanApprove_${i}`) === 'on';
		contactValues.push({ name, email, phone, role, canApprove });
		if (!name && !email) continue; // untouched spare row
		if (!name) {
			errors[`contactName_${i}`] = m.client_validation_contact_name_required();
			continue;
		}
		if (!email) {
			errors[`contactEmail_${i}`] = m.client_validation_contact_email_required({ name });
			continue;
		}
		contacts.push({ name, email, phone: phone || null, role: role || null, canApprove });
	}

	const values: ClientFormValues = {
		legalName,
		taxId,
		vatId,
		country,
		addressLine1,
		addressLine2,
		addressCity,
		addressPostalCode,
		addressRegion,
		noticeChannel: noticeChannelValue,
		sdiCode,
		pecAddress,
		contacts: contactValues
	};

	if (Object.keys(errors).length > 0) return { ok: false, errors, values };

	return {
		ok: true,
		values,
		input: {
			legalName,
			// `|| null` throughout: an empty form field means "not known", and
			// storing `''` would make a column that looks answered and reads
			// blank on an invoice. `clientInvoicingGaps` treats both as
			// missing precisely because nothing stops a `''` getting in, but
			// the parser is the place not to create one.
			taxId: taxId || null,
			vatId: vatId || null,
			country,
			addressLine1: addressLine1 || null,
			addressLine2: addressLine2 || null,
			addressCity: addressCity || null,
			addressPostalCode: addressPostalCode || null,
			addressRegion: addressRegion || null,
			noticeChannel: (noticeChannelValue || null) as NoticeChannel | null,
			sdiCode: sdiCode || null,
			pecAddress: pecAddress || null,
			contacts
		}
	};
}
