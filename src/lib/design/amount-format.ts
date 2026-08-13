/**
 * The pure branch behind `Amount.svelte`: which formatter runs for which
 * kind of stored amount (#203). Kept here, not inlined in the component,
 * so the one thing that must never regress — a `MinorUnits` value never
 * reaching `formatAmount`, a major-unit value never reaching
 * `formatMinorUnits` — is testable without mounting Svelte (no
 * `@testing-library/svelte` in this project; see package.json).
 *
 * `AmountValue` is a union, not a single `{ amount: number }` shape,
 * because `rate_card.amount` is a plain decimal in major units while
 * every other amount this product stores (`expense.amount`,
 * `invoice.*`, the ceilings) is `MinorUnits` — see the comment on
 * `MinorUnits` in `$lib/money` for how many times mixing the two up has
 * already shipped. The two branches carry incompatible branded types, so
 * constructing the wrong one for a given source is a compile error.
 */
import { formatAmount, formatMinorUnits } from '$lib/i18n/format';
import type { Locale } from '$lib/paraglide/runtime';
import type { MinorUnits, NotMinorUnits } from '$lib/money';

export type AmountSize = 'figure' | 'md' | 'inline';

export type AmountValue =
	| { readonly minorUnits: MinorUnits; readonly major?: never }
	| { readonly major: NotMinorUnits; readonly minorUnits?: never };

export function formatAmountValue(value: AmountValue, currency: string, locale: Locale): string {
	return value.minorUnits !== undefined
		? formatMinorUnits(value.minorUnits, currency, locale)
		: formatAmount(value.major, currency, locale);
}
