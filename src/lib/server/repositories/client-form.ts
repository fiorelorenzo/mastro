import * as m from '$lib/paraglide/messages';
import { noticeChannel, type NoticeChannel } from '$lib/server/db/schema';
import type { ClientInput } from './client';

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

	const taxId = string('taxId');
	if (!taxId) errors.taxId = m.client_validation_tax_id_required();

	const vatId = string('vatId');

	const country = string('country').toUpperCase();
	if (!/^[A-Z]{2}$/.test(country)) errors.country = m.client_validation_country_invalid();

	const addressLine1 = string('addressLine1');
	if (!addressLine1) errors.addressLine1 = m.client_validation_address_line1_required();
	const addressLine2 = string('addressLine2');
	const addressCity = string('addressCity');
	if (!addressCity) errors.addressCity = m.client_validation_city_required();
	const addressPostalCode = string('addressPostalCode');
	if (!addressPostalCode) errors.addressPostalCode = m.client_validation_postal_code_required();
	const addressRegion = string('addressRegion');

	const noticeChannelValue = string('noticeChannel');
	if (!noticeChannel.enumValues.includes(noticeChannelValue as NoticeChannel)) {
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
	if (contacts.length === 0) errors.contacts = m.client_validation_contacts_required();

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
		contacts: contactValues
	};

	if (Object.keys(errors).length > 0) return { ok: false, errors, values };

	return {
		ok: true,
		values,
		input: {
			legalName,
			taxId,
			vatId: vatId || null,
			country,
			addressLine1,
			addressLine2: addressLine2 || null,
			addressCity,
			addressPostalCode,
			addressRegion: addressRegion || null,
			noticeChannel: noticeChannelValue as NoticeChannel,
			contacts
		}
	};
}
