import * as m from '$lib/paraglide/messages';
import {
	disbursementPeriod,
	rateCardKind,
	rateUnit,
	type DisbursementPeriod,
	type RateCardKind,
	type RateUnit
} from '$lib/server/db/schema';
import type { RateCardInput } from './rate-card';

export type RateCardFormValues = {
	validFrom: string;
	validTo: string;
	kind: string;
	amount: string;
	unit: string;
	allowedFractions: string;
	minimumHours: string;
	disbursementPeriod: string;
};

export type RateCardFormResult =
	| { ok: true; input: Omit<RateCardInput, 'contractId'>; values: RateCardFormValues }
	| { ok: false; errors: Record<string, string>; values: RateCardFormValues };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL = /^-?\d+(\.\d{1,2})?$/;

/**
 * Parses and validates a rate card create/edit submission (#105).
 * `amount`/`minimumHours` follow `rate_card`'s own convention — a plain
 * decimal (see `domain/rate-card.ts`'s `priceRateCard`), not `MinorUnits`
 * like `invoice`/`expense` — so they are read with a decimal-shape check
 * and `Number(...)`, never `decimalStringToMinorUnits`.
 *
 * Overlap between validity periods is not checked here: the database's
 * `rate_card_no_overlapping_validity` exclusion constraint is the
 * authority (#19), and the call site turns its `23P01` into a form error
 * on `validFrom` via `isPostgresConstraintViolation`, the same way #17's
 * duplicate tax id already does.
 */
export function parseRateCardForm(formData: FormData): RateCardFormResult {
	const errors: Record<string, string> = {};
	const string = (key: string) => String(formData.get(key) ?? '').trim();

	const validFrom = string('validFrom');
	if (!ISO_DATE.test(validFrom)) errors.validFrom = m.rate_card_validation_valid_from_required();

	const validTo = string('validTo');
	if (validTo && !ISO_DATE.test(validTo))
		errors.validTo = m.rate_card_validation_valid_to_invalid();

	const kindRaw = string('kind');
	if (!rateCardKind.enumValues.includes(kindRaw as RateCardKind)) {
		errors.kind = m.rate_card_validation_kind_invalid();
	}
	const kind = kindRaw as RateCardKind;

	const amountRaw = string('amount');
	const amount = Number(amountRaw);
	if (!DECIMAL.test(amountRaw) || amount <= 0) {
		errors.amount = m.rate_card_validation_amount_invalid();
	}

	const unitRaw = string('unit');
	if (!rateUnit.enumValues.includes(unitRaw as RateUnit)) {
		errors.unit = m.rate_card_validation_unit_invalid();
	}

	const allowedFractionsRaw = string('allowedFractions');
	const allowedFractions = allowedFractionsRaw
		.split(',')
		.map((part) => part.trim())
		.filter((part) => part.length > 0)
		.map(Number);
	if (
		allowedFractions.length === 0 ||
		allowedFractions.some((fraction) => !Number.isFinite(fraction) || fraction <= 0)
	) {
		errors.allowedFractions = m.rate_card_validation_allowed_fractions_invalid();
	}

	const minimumHoursRaw = string('minimumHours');
	let minimumHours: number | null = null;
	if (kind === 'hourly' && minimumHoursRaw) {
		const hours = Number(minimumHoursRaw);
		if (!DECIMAL.test(minimumHoursRaw) || hours <= 0) {
			errors.minimumHours = m.rate_card_validation_minimum_hours_invalid();
		} else {
			minimumHours = hours;
		}
	}

	const disbursementPeriodRaw = string('disbursementPeriod');
	let disbursementPeriodValue: DisbursementPeriod | null = null;
	if (kind === 'fixed_recurring') {
		if (!disbursementPeriod.enumValues.includes(disbursementPeriodRaw as DisbursementPeriod)) {
			errors.disbursementPeriod = m.rate_card_validation_disbursement_period_required();
		} else {
			disbursementPeriodValue = disbursementPeriodRaw as DisbursementPeriod;
		}
	}

	const values: RateCardFormValues = {
		validFrom,
		validTo,
		kind: kindRaw,
		amount: amountRaw,
		unit: unitRaw,
		allowedFractions: allowedFractionsRaw,
		minimumHours: minimumHoursRaw,
		disbursementPeriod: disbursementPeriodRaw
	};

	if (Object.keys(errors).length > 0) return { ok: false, errors, values };

	return {
		ok: true,
		values,
		input: {
			validFrom,
			validTo: validTo || null,
			kind,
			amount,
			unit: unitRaw as RateUnit,
			allowedFractions,
			minimumHours,
			disbursementPeriod: disbursementPeriodValue
		}
	};
}
