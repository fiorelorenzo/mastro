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
 */
export const genericPack: FiscalPack = {
	id: 'generic',
	version: '1',
	effectiveFrom: '2024-01-01',
	displayName: { en: 'Generic', it: 'Generico' },
	basis: 'accrual',
	fiscalYear: { startMonth: 1, startDay: 1 },
	ceilings: [],
	treatments: [],
	charges: [],
	formats: []
};
