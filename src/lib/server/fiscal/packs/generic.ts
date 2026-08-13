import type { FiscalPack } from '../pack';

/**
 * The pack for anyone in a jurisdiction mastro has not modelled. Accrual
 * basis, calendar fiscal year, no ceilings, no statutory charges, no
 * national invoice format — it is the acceptance test for invariant 1
 * (AGENTS.md): select it and the product still works, minus ceilings.
 *
 * The empty arrays are not placeholders. A ceiling widget reading
 * `pack.ceilings` gets `[]`, a valid and complete answer, not a missing
 * field to special-case around.
 *
 * `unresolvedRevenue: 'carries_forward'` (#122) is the same reasoning:
 * an accrual basis never leaves a row unresolved, so the value is inert
 * here, but `'carries_forward'` is also the only value that can never
 * silently drop real revenue, which is the one property this pack keeps
 * even with no jurisdiction modelled behind it.
 *
 * `defaultTreatment` (#216) is left absent, unlike the arrays above: an
 * unmodelled jurisdiction genuinely has no opinion on tax treatment, and
 * `[]` would be a specific, wrong claim (0% VAT) rather than an honest
 * "not represented" — the invoice screen's manual fallback exists for
 * exactly this pack.
 */
export const genericPack: FiscalPack = {
	id: 'generic',
	version: '1',
	effectiveFrom: '2024-01-01',
	displayName: { en: 'Generic', it: 'Generico' },
	basis: 'accrual',
	fiscalYear: { startMonth: 1, startDay: 1 },
	ceilings: [],
	unresolvedRevenue: 'carries_forward',
	treatments: [],
	charges: [],
	formats: []
};
