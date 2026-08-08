// The home screen (#57, #58, #59): three widgets, each reading a query
// surface the fiscal engine already exposes rather than recomputing a
// figure here. All amounts assume a single practice currency (EUR) — the
// same simplification `fiscal/ledger.ts`'s `LedgerRow` already makes by
// carrying no currency of its own.
import { evaluateActiveCeilings } from '$lib/server/fiscal/ceiling-status';
import { addMinorUnits } from '$lib/money';
import { irrevocabilityWindowEnd } from '$lib/server/fiscal/certainty';
import {
	forecastRenewalAssumptions,
	forecastRevenue,
	forecastRevenueByMonth,
	type ContractRenewalAssumptionForecast
} from '$lib/server/fiscal/forecast';
import { fetchClientRevenueBreakdown } from '$lib/server/fiscal/revenue';
import { listClients } from '$lib/server/repositories/client';
import { listContractsWithClient } from '$lib/server/repositories/contract';
import { listProposals } from '$lib/server/repositories/proposal';
import type { CashCalendarMarker } from '$lib/dashboard/cash-calendar';
import type { RenewalAssumptionContribution } from '$lib/dashboard/renewal-assumption';
import type { PageServerLoad } from './$types';

const PAST_MONTHS = 6;
const FUTURE_MONTHS = 6;

/** `monthStart` (a `YYYY-MM-01` date) shifted by `months`, clamped to the
 * first of the resulting month — mirrors `domain/recurring-fee.ts`'s own
 * `addMonthsIso`, a small enough pure date step that this codebase
 * duplicates it per call site (see also `fiscal/ceiling.ts`'s and
 * `fiscal/certainty.ts`'s own `addDaysIso`) rather than sharing one. */
function addMonthsToMonthStart(monthStart: string, months: number): string {
	const [year, month] = monthStart.split('-').map(Number);
	const total = year * 12 + (month - 1) + months;
	return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-01`;
}

/** `date` shifted by `days`, wrapping months and years correctly — the
 * same UTC-anchored arithmetic `fiscal/ceiling.ts` and `fiscal/certainty.ts`
 * each keep their own copy of, for the same reason. */
function addDaysIso(date: string, days: number): string {
	const parsed = new Date(`${date}T00:00:00Z`);
	parsed.setUTCDate(parsed.getUTCDate() + days);
	return parsed.toISOString().slice(0, 10);
}

/** #127: `forecastRenewalAssumptions`'s own return shape, narrowed to the
 * contracts that actually contribute a positive figure over whichever
 * window the caller asked it for — the ceiling meters below and the cash
 * calendar each call the query with their own window, then run it through
 * this same filter/reshape, never a second fiscal calculation. */
function toAssumptionViews(
	forecasted: readonly ContractRenewalAssumptionForecast[]
): RenewalAssumptionContribution[] {
	return forecasted
		.filter((row) => row.contribution > 0)
		.map((row) => ({
			contractId: row.contractId,
			contractTitle: row.contractTitle,
			probability: row.assumption.probability,
			expectedVolumeMinorUnits: row.assumption.expectedVolumeMinorUnits,
			horizonEndsOn: row.assumption.horizonEndsOn,
			contributionMinorUnits: row.contribution
		}));
}

// / is protected by the default guard (src/hooks.server.ts), so locals.user
// is always set here: an unauthenticated request never reaches this load.
export const load: PageServerLoad = async ({ locals }) => {
	const now = new Date();
	const today = now.toISOString().slice(0, 10);
	const currentMonthStart = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
	const windowFrom = addMonthsToMonthStart(currentMonthStart, -PAST_MONTHS);
	const windowTo = addMonthsToMonthStart(currentMonthStart, FUTURE_MONTHS);
	const currentYear = Number(today.slice(0, 4));
	const yearFrom = `${currentYear}-01-01`;
	const yearTo = `${currentYear + 1}-01-01`;

	const [
		evaluatedCeilings,
		monthly,
		contracts,
		clientRevenue,
		clients,
		calendarAssumptions,
		pendingProposals
	] = await Promise.all([
		evaluateActiveCeilings(today),
		forecastRevenueByMonth(today, windowFrom, windowTo),
		listContractsWithClient(),
		fetchClientRevenueBreakdown(yearFrom, yearTo),
		listClients(),
		// #127: every recorded renewal assumption paired with the figure
		// it contributes to the calendar's own rolling window.
		forecastRenewalAssumptions(today, windowFrom, windowTo),
		// #64: the review queue's own pending count, so the home
		// screen's one-tap link can say how many are actually waiting.
		listProposals('pending')
	]);

	// #57 — the hero ceiling meter reads whole-practice, pack-origin
	// ceilings only. A contract's own client-share cap (measure
	// 'percentage_share', perimeter 'client') is invariant 2's other kind
	// of ceiling: it belongs to #59's reference line, not the home screen,
	// and it survives a regime change that empties `pack.ceilings` — which
	// is exactly why filtering on `origin === 'pack'` here, rather than
	// reading `pack.ceilings.length` directly, is what makes the widget
	// disappear under the generic pack without a special case for it.
	const heroCeilings = evaluatedCeilings.filter(
		(evaluated) =>
			evaluated.ceiling.origin === 'pack' && evaluated.ceiling.perimeter.kind === 'all_clients'
	);
	const [heroProjections, heroAssumptions] = await Promise.all([
		Promise.all(
			heroCeilings.map((evaluated) => forecastRevenue(today, today, evaluated.period.to))
		),
		// #127: the same query, over the same window, for the assumptions
		// that produced part of that projection.
		Promise.all(
			heroCeilings.map((evaluated) => forecastRenewalAssumptions(today, today, evaluated.period.to))
		)
	]);
	const ceilings = heroCeilings.map((evaluated, index) => ({
		id: evaluated.ceiling.id,
		label: evaluated.ceiling.label,
		basis: evaluated.ceiling.basis,
		periodFrom: evaluated.period.from,
		periodTo: evaluated.period.to,
		currentValue: evaluated.currentValue,
		limitValue: evaluated.limitValue,
		usageRatio: evaluated.usageRatio,
		crossed: evaluated.crossed,
		alertLevels: evaluated.ceiling.alertLevels,
		activeAlertLevels: evaluated.activeAlertLevels,
		consequence: evaluated.ceiling.consequence,
		// The dashed year-end projection the epic asks for: cash already in
		// hand plus what's committed and projected between today and the
		// period's own end — never a second forecast computed by hand here,
		// just the two figures `forecast.ts` already exports, added once.
		projectedEnd: addMinorUnits(
			evaluated.currentValue,
			heroProjections[index].committed.amount,
			heroProjections[index].projected.amount
		),
		assumptions: toAssumptionViews(heroAssumptions[index])
	}));

	// #58 — vertical markers for contractual dates: a contract's own
	// expiry, the renewal-notice window opening, and the irrevocability
	// window's own edge (`fiscal/certainty.ts`'s `irrevocabilityWindowEnd`,
	// reused rather than reimplemented), whichever fall inside the rolling
	// window. A draft contract is not yet a commitment, so it carries none.
	const markers: CashCalendarMarker[] = [];
	for (const row of contracts) {
		if (row.status === 'draft') continue;
		const label = { clientName: row.client.legalName, contractTitle: row.title };
		if (row.endsOn !== null && row.endsOn >= windowFrom && row.endsOn < windowTo) {
			markers.push({ date: row.endsOn, kind: 'contract_expiry', contractId: row.id, ...label });
		}
		if (row.renewalType !== 'none' && row.endsOn !== null && row.renewalNoticeDays !== null) {
			const noticeOpensOn = addDaysIso(row.endsOn, -row.renewalNoticeDays);
			if (noticeOpensOn >= windowFrom && noticeOpensOn < windowTo) {
				markers.push({
					date: noticeOpensOn,
					kind: 'renewal_window',
					contractId: row.id,
					...label
				});
			}
		}
		const irrevocabilityEnd = irrevocabilityWindowEnd(row, today);
		if (
			irrevocabilityEnd !== null &&
			irrevocabilityEnd >= windowFrom &&
			irrevocabilityEnd < windowTo
		) {
			markers.push({
				date: irrevocabilityEnd,
				kind: 'irrevocability_edge',
				contractId: row.id,
				...label
			});
		}
	}

	// #59 — client concentration and its reference line: any percentage-
	// share ceiling in force, pack or contract origin alike (a pack could,
	// in principle, cap one client's share of the whole practice the same
	// way a contract clause does — the reference line reads the measure,
	// not the origin).
	const shareCeilings = evaluatedCeilings
		.filter((evaluated) => evaluated.ceiling.measure === 'percentage_share')
		.map((evaluated) => ({
			id: evaluated.ceiling.id,
			ratio: evaluated.ceiling.value,
			clientId:
				evaluated.ceiling.perimeter.kind === 'client' ? evaluated.ceiling.perimeter.clientId : null,
			label: evaluated.ceiling.label,
			consequence: evaluated.ceiling.consequence,
			crossed: evaluated.crossed
		}));
	const clientNameById = Object.fromEntries(clients.map((c) => [c.id, c.legalName]));

	return {
		user: locals.user!,
		ceilings,
		// #64: the record-day CTA's sibling on the home screen — how many
		// proposals are waiting, so the one tap to `/proposals` carries
		// context before it's even taken.
		pendingProposalsCount: pendingProposals.length,
		cashCalendar: {
			from: windowFrom,
			to: windowTo,
			months: monthly,
			markers,
			assumptions: toAssumptionViews(calendarAssumptions)
		},
		concentration: {
			from: yearFrom,
			to: yearTo,
			total: clientRevenue.total,
			byClient: clientRevenue.byClient.map((share) => ({
				...share,
				clientName: clientNameById[share.clientId] ?? share.clientId
			})),
			shareCeilings
		}
	};
};
