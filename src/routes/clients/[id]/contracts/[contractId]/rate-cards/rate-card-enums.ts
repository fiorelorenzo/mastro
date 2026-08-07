import * as m from '$lib/paraglide/messages';

/**
 * Plain literal lists mirroring `rate_card`'s own Postgres enums
 * (`$lib/server/db/schema/rate-card.ts`), duplicated here the same reason
 * `routes/clients/notice-channel.ts` duplicates `notice_channel`: used
 * from client components, and `$lib/server/db/schema` cannot be bundled
 * into client code.
 */
export const rateCardKinds = ['fixed_recurring', 'daily', 'hourly', 'one_off'] as const;
export type RateCardKindValue = (typeof rateCardKinds)[number];

export const rateUnits = ['hour', 'day', 'month', 'year', 'lump_sum'] as const;
export type RateUnitValue = (typeof rateUnits)[number];

export const disbursementPeriods = ['monthly', 'quarterly', 'annual', 'one_time'] as const;
export type DisbursementPeriodValue = (typeof disbursementPeriods)[number];

export function rateCardKindLabel(value: RateCardKindValue): string {
	switch (value) {
		case 'fixed_recurring':
			return m.rate_card_kind_fixed_recurring();
		case 'daily':
			return m.rate_card_kind_daily();
		case 'hourly':
			return m.rate_card_kind_hourly();
		case 'one_off':
			return m.rate_card_kind_one_off();
	}
}

export function rateUnitLabel(value: RateUnitValue): string {
	switch (value) {
		case 'hour':
			return m.rate_card_unit_hour();
		case 'day':
			return m.rate_card_unit_day();
		case 'month':
			return m.rate_card_unit_month();
		case 'year':
			return m.rate_card_unit_year();
		case 'lump_sum':
			return m.rate_card_unit_lump_sum();
	}
}

export function disbursementPeriodLabel(value: DisbursementPeriodValue): string {
	switch (value) {
		case 'monthly':
			return m.rate_card_disbursement_period_monthly();
		case 'quarterly':
			return m.rate_card_disbursement_period_quarterly();
		case 'annual':
			return m.rate_card_disbursement_period_annual();
		case 'one_time':
			return m.rate_card_disbursement_period_one_time();
	}
}
