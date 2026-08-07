import type { FiscalPack } from '../pack';
import { legalText } from '$lib/legal/legal-text';

/**
 * Italy's standard regime: accrual basis, no revenue ceiling, ordinary VAT.
 * Its job is invariant 2 (AGENTS.md): switching a fiscal profile to this
 * pack must remove the flat-rate ceilings and leave anything contract-level
 * untouched, with no code change anywhere outside the packs (#34). See
 * `it-standard.test.ts` for that proof.
 *
 * `treatments` carries one representative ordinary-regime VAT treatment —
 * territoriality for cross-border B2B services, SDI Natura code N2.1 — not
 * an exhaustive VAT-code catalogue. Under ordinary VAT the default case
 * (domestic, standard-rate) needs no annotation at all, which is exactly
 * why `TaxTreatment.legalText` exists: it is only for the cases that still
 * require mandatory wording even under the standard regime. A fuller
 * catalogue (reduced rates, article-10 exemptions, split payment) is a
 * plain data addition here whenever real invoicing needs it — see the PR
 * description for what is and is not modelled.
 *
 * Source, checked at implementation time (2026-08-07): D.P.R. 26 ottobre
 * 1972, n. 633, art. 7-ter, comma 1, lettera a) (services are taxable where
 * the business customer is established, so a service to a customer
 * established abroad falls outside Italian VAT); corroborated by multiple
 * 2026-dated practitioner guides quoting the same article and the N2.1
 * code, not read directly against the consolidated D.P.R. text.
 */
export const itStandardPack: FiscalPack = {
	id: 'it-standard',
	version: '1',
	effectiveFrom: '2024-01-01',
	displayName: { en: 'Italy — standard regime', it: 'Regime ordinario' },
	basis: 'accrual',
	fiscalYear: { startMonth: 1, startDay: 1 },
	ceilings: [],
	treatments: [
		{
			code: 'N2.1',
			label: {
				en: 'Not subject to VAT — cross-border B2B services',
				it: 'Operazione non soggetta per carenza del presupposto territoriale'
			},
			legalText: legalText(
				'it',
				"Operazione non soggetta ad IVA ai sensi dell'articolo 7-ter del D.P.R. 26 ottobre 1972, n. 633"
			)
		}
	],
	charges: [],
	// Shared with it-flat-rate; see that file's comment on 'FPR12'.
	formats: ['FPR12']
};
