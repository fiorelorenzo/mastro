import * as m from '$lib/paraglide/messages';
import { defaultRegistry, type PackRegistry } from '$lib/server/fiscal/registry';
import type { FiscalProfileInput } from './fiscal-profile';

export type FiscalProfileFormValues = {
	packKey: string;
	validFrom: string;
	validTo: string;
};

export type FiscalProfileFormResult =
	| { ok: true; input: FiscalProfileInput; values: FiscalProfileFormValues }
	| { ok: false; errors: Record<string, string>; values: FiscalProfileFormValues };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The `<select>` option value a pack picker uses — stable and round-trips
 * through `parseFiscalProfileForm` without a lookup helper `registry.ts`
 * does not export (its own `packKey` is private to that module). */
export function fiscalPackKey(pack: { id: string; version: string }): string {
	return `${pack.id}@${pack.version}`;
}

/**
 * Parses and validates a fiscal profile submission (#223): a pack picked
 * from the registry (never a free-text id — a profile pointing at an
 * unregistered pack is a deployment error the UI should make impossible,
 * not just discourage) and a validity period. `validTo`'s relationship to
 * `validFrom` mirrors the database's own `fiscal_profile_valid_range`
 * CHECK, caught here first for the same reason `expense-form.ts` catches
 * its own mismatch before the round trip. Overlap with another profile is
 * not checked here: the database's `fiscal_profile_no_overlap` exclusion
 * constraint is the authority, and the call site turns its `23P01` into a
 * form error on `validFrom`, the same way `rate-card-form.ts` does.
 */
export function parseFiscalProfileForm(
	formData: FormData,
	registry: PackRegistry = defaultRegistry
): FiscalProfileFormResult {
	const errors: Record<string, string> = {};
	const string = (key: string) => String(formData.get(key) ?? '').trim();

	const packKey = string('packKey');
	const pack = registry.get(packKey);
	if (!pack) errors.packKey = m.settings_fiscal_validation_pack_required();

	const validFrom = string('validFrom');
	if (!ISO_DATE.test(validFrom))
		errors.validFrom = m.settings_fiscal_validation_valid_from_required();

	const validToRaw = string('validTo');
	let validTo: string | null = null;
	if (validToRaw) {
		if (!ISO_DATE.test(validToRaw)) {
			errors.validTo = m.settings_fiscal_validation_valid_to_invalid();
		} else {
			validTo = validToRaw;
		}
	}

	if (!errors.validTo && validTo !== null && ISO_DATE.test(validFrom) && validTo <= validFrom) {
		errors.validTo = m.settings_fiscal_validation_valid_to_before_from();
	}

	const values: FiscalProfileFormValues = { packKey, validFrom, validTo: validToRaw };

	if (Object.keys(errors).length > 0) return { ok: false, errors, values };

	return {
		ok: true,
		values,
		input: { packId: pack!.id, packVersion: pack!.version, validFrom, validTo }
	};
}
