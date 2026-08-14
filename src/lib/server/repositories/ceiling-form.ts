import * as m from '$lib/paraglide/messages';
import { getLocale } from '$lib/paraglide/runtime';
import { decimalStringToMinorUnits } from '$lib/server/import/decimal';
import { NO_MINOR_UNITS, type MinorUnits } from '$lib/money';
import { ceilingBasis } from '$lib/server/db/schema';
import type { CeilingBasis } from '$lib/server/fiscal/pack';
import type { CeilingInput } from './ceiling';

export type CeilingFormValues = {
	code: string;
	label: string;
	measure: string;
	absoluteValue: string;
	percentageValue: string;
	basis: string;
	consequence: string;
};

export type CeilingFormResult =
	| { ok: true; input: CeilingInput; values: CeilingFormValues }
	| { ok: false; errors: Record<string, string>; values: CeilingFormValues };

/**
 * A ceiling created here is imposed by the contract itself (AGENTS.md
 * invariant 2), authored by whoever is entering it — not translated pack
 * copy. There is no translation workflow for a self-hoster's own words
 * about their own contract, so `label`/`consequence` below carry the one
 * string typed under every interface language: honest (nothing here
 * claims to be a translation) and correct either way the ceiling is
 * later read (`bundle[locale]`), unlike leaving a language key empty,
 * which `pnpm check`'s `LabelBundle` gate would reject anyway.
 */
const ceilingBases = ceilingBasis.enumValues;

/**
 * Parses and validates a contract-ceiling create/edit submission (#223).
 * `measure` decides which of `absoluteValue`/`percentageValue` is read,
 * mirroring the database's own `ceiling_value_matches_measure` CHECK — the
 * unused half is dropped from `input` entirely rather than sent as a stray
 * empty string. `contractId` is not read here, the same reason
 * `parseContractForm` skips it: it comes from the route. `alertLevels` is
 * always empty: authoring custom alert thresholds is the alert engine's
 * own surface (#74), not this form's job — an empty array is a valid,
 * complete `Ceiling` (`packs/generic.ts` ships the same shape for every
 * one of its ceilings, of which it has none). `legalBasis` is always
 * `null`: a contract clause is not a statutory citation (`$lib/legal/
 * legal-text.ts`'s own scope), so nothing here manufactures a `LegalText`
 * out of free text the practitioner typed.
 */
export function parseCeilingForm(
	formData: FormData,
	currency: string,
	contractId: string
): CeilingFormResult {
	const errors: Record<string, string> = {};
	const string = (key: string) => String(formData.get(key) ?? '').trim();

	const code = string('code');
	if (!code) errors.code = m.ceiling_validation_code_required();

	const label = string('label');
	if (!label) errors.label = m.ceiling_validation_label_required();

	const measure = string('measure');
	if (measure !== 'absolute_amount' && measure !== 'percentage_share') {
		errors.measure = m.ceiling_validation_measure_invalid();
	}

	const absoluteValueRaw = string('absoluteValue');
	let absoluteValue: MinorUnits = NO_MINOR_UNITS;
	if (measure === 'absolute_amount') {
		try {
			absoluteValue = decimalStringToMinorUnits(absoluteValueRaw, currency, getLocale());
			if (absoluteValue <= 0) throw new Error('non-positive');
		} catch {
			errors.absoluteValue = m.ceiling_validation_absolute_value_invalid();
		}
	}

	const percentageValueRaw = string('percentageValue');
	let percentageRatio = 0;
	if (measure === 'percentage_share') {
		const percent = Number(percentageValueRaw.replace(',', '.'));
		if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
			errors.percentageValue = m.ceiling_validation_percentage_value_invalid();
		} else {
			percentageRatio = percent / 100;
		}
	}

	const basis = string('basis');
	if (!ceilingBases.includes(basis as CeilingBasis)) {
		errors.basis = m.ceiling_validation_basis_invalid();
	}

	const consequence = string('consequence');
	if (!consequence) errors.consequence = m.ceiling_validation_consequence_required();

	const values: CeilingFormValues = {
		code,
		label,
		measure,
		absoluteValue: absoluteValueRaw,
		percentageValue: percentageValueRaw,
		basis,
		consequence
	};

	if (Object.keys(errors).length > 0) return { ok: false, errors, values };

	// `CeilingLimit` correlates `measure` with the type of `value`, and
	// spreading a union loses that: `{ ...limit }` widens to
	// `{ measure: A | B; value: MinorUnits | number }`, which is assignable
	// to neither member. Building the whole object per branch against the
	// annotated type keeps the correlation the money types exist to enforce.
	const common = {
		contractId,
		code,
		label: { en: label, it: label },
		legalBasis: null,
		basis: basis as CeilingBasis,
		alertLevels: [],
		consequence: { en: consequence, it: consequence }
	} as const;

	const input: CeilingInput =
		measure === 'absolute_amount'
			? { ...common, measure: 'absolute_amount', value: absoluteValue }
			: { ...common, measure: 'percentage_share', value: percentageRatio };

	return { ok: true, values, input };
}
