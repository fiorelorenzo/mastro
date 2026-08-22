import * as m from '$lib/paraglide/messages';

/**
 * Plain literal lists mirroring `ceiling`'s own Postgres enums
 * (`$lib/server/db/schema/ceiling.ts`) — kept here, not imported from the
 * schema, because that module pulls in `drizzle-orm/pg-core` and every
 * other server-only dependency the schema barrel carries, and this file
 * is imported from a `.svelte` component (#223's `CeilingForm.svelte`),
 * which SvelteKit refuses to let touch `$lib/server` at runtime. The
 * schema's own `ceilingBasisValues`/`ceilingMeasureValues` `satisfies`
 * clauses are `$lib/server/fiscal/pack.ts`'s own union types, so a drift
 * between the two lists still fails `pnpm check` there.
 */
export const ceilingBases = [
	'cash_received_calendar_year',
	'invoiced_calendar_year',
	'cash_received_contract_year'
] as const;
export type CeilingBasisValue = (typeof ceilingBases)[number];

export const ceilingMeasures = ['absolute_amount', 'percentage_share'] as const;
export type CeilingMeasureValue = (typeof ceilingMeasures)[number];

export function ceilingMeasureLabel(value: CeilingMeasureValue): string {
	switch (value) {
		case 'absolute_amount':
			return m.ceiling_form_measure_absolute_amount();
		case 'percentage_share':
			return m.ceiling_form_measure_percentage_share();
	}
}
