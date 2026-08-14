import * as m from '$lib/paraglide/messages';
import type { PracticeProfileInput } from './practice-profile';

export type PracticeProfileFormValues = {
	legalName: string;
	taxId: string;
	vatId: string;
	country: string;
	addressLine1: string;
	addressLine2: string;
	addressCity: string;
	addressPostalCode: string;
	addressRegion: string;
};

export type PracticeProfileFormResult =
	| { ok: true; input: PracticeProfileInput; values: PracticeProfileFormValues }
	| { ok: false; errors: Record<string, string>; values: PracticeProfileFormValues };

/** Parses and validates the practice profile submission — same field set
 * and validation shape as `client-form.ts`'s legal identity and address
 * cards, minus the notice channel and contacts a practice has no use for. */
export function parsePracticeProfileForm(formData: FormData): PracticeProfileFormResult {
	const errors: Record<string, string> = {};
	const string = (key: string) => String(formData.get(key) ?? '').trim();

	const legalName = string('legalName');
	if (!legalName) errors.legalName = m.practice_form_validation_legal_name_required();

	const taxId = string('taxId');
	if (!taxId) errors.taxId = m.practice_form_validation_tax_id_required();

	const vatId = string('vatId');

	const country = string('country').toUpperCase();
	if (!/^[A-Z]{2}$/.test(country)) errors.country = m.practice_form_validation_country_invalid();

	const addressLine1 = string('addressLine1');
	if (!addressLine1) errors.addressLine1 = m.practice_form_validation_address_line1_required();
	const addressLine2 = string('addressLine2');
	const addressCity = string('addressCity');
	if (!addressCity) errors.addressCity = m.practice_form_validation_city_required();
	const addressPostalCode = string('addressPostalCode');
	if (!addressPostalCode)
		errors.addressPostalCode = m.practice_form_validation_postal_code_required();
	const addressRegion = string('addressRegion');

	const values: PracticeProfileFormValues = {
		legalName,
		taxId,
		vatId,
		country,
		addressLine1,
		addressLine2,
		addressCity,
		addressPostalCode,
		addressRegion
	};

	if (Object.keys(errors).length > 0) return { ok: false, errors, values };

	return {
		ok: true,
		input: {
			legalName,
			taxId,
			vatId: vatId || null,
			country,
			addressLine1,
			addressLine2: addressLine2 || null,
			addressCity,
			addressPostalCode,
			addressRegion: addressRegion || null
		},
		values
	};
}
