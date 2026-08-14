import * as m from '$lib/paraglide/messages';
import { getLocale } from '$lib/paraglide/runtime';
import { decimalStringToMinorUnits } from '$lib/server/import/decimal';
import { NO_MINOR_UNITS, type MinorUnits } from '$lib/money';
import type { ContractRenewalAssumptionInput } from './contract-renewal-assumption';

export type RenewalAssumptionFormValues = {
	probability: string;
	expectedVolume: string;
	horizonEndsOn: string;
};

export type RenewalAssumptionFormResult =
	| {
			ok: true;
			input: ContractRenewalAssumptionInput;
			values: RenewalAssumptionFormValues;
	  }
	| { ok: false; errors: Record<string, string>; values: RenewalAssumptionFormValues };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parses and validates a renewal-assumption submission (#39, #223): set
 * from the contract's own renewal block, never inferred — the schema's
 * own comment on `contract_renewal_assumption` is explicit that this
 * number is the human's own estimate. `probability` is entered as a
 * percentage (0–100) and stored as the 0–1 ratio the table and
 * `fiscal/certainty.ts` both expect; `contractId` is not read here, the
 * same reason `parseContractForm` skips it.
 */
export function parseRenewalAssumptionForm(
	formData: FormData,
	currency: string,
	contractId: string
): RenewalAssumptionFormResult {
	const errors: Record<string, string> = {};
	const string = (key: string) => String(formData.get(key) ?? '').trim();

	const probabilityRaw = string('probability');
	const probabilityPercent = Number(probabilityRaw.replace(',', '.'));
	let probability = 0;
	if (!Number.isFinite(probabilityPercent) || probabilityPercent < 0 || probabilityPercent > 100) {
		errors.probability = m.renewal_assumption_validation_probability_invalid();
	} else {
		probability = probabilityPercent / 100;
	}

	const expectedVolumeRaw = string('expectedVolume');
	let expectedVolumeMinorUnits: MinorUnits = NO_MINOR_UNITS;
	try {
		expectedVolumeMinorUnits = decimalStringToMinorUnits(expectedVolumeRaw, currency, getLocale());
		if (expectedVolumeMinorUnits < 0) throw new Error('negative');
	} catch {
		errors.expectedVolume = m.renewal_assumption_validation_expected_volume_invalid();
	}

	const horizonEndsOn = string('horizonEndsOn');
	if (!ISO_DATE.test(horizonEndsOn)) {
		errors.horizonEndsOn = m.renewal_assumption_validation_horizon_invalid();
	}

	const values: RenewalAssumptionFormValues = {
		probability: probabilityRaw,
		expectedVolume: expectedVolumeRaw,
		horizonEndsOn
	};

	if (Object.keys(errors).length > 0) return { ok: false, errors, values };

	return {
		ok: true,
		values,
		input: { contractId, probability, expectedVolumeMinorUnits, horizonEndsOn }
	};
}
