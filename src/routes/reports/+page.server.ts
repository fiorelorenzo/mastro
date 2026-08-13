// The cash calendar and client-concentration charts (#58, #59), moved
// off the home screen by #234: the home screen's job is triage ("what
// needs me, and am I safe"), not forecasting, and these two widgets are
// the least glanceable, most inspection-heavy things the old dashboard
// carried — exactly what the mockup's own footer links
// ("Concentrazione clienti" / "Cassa per mese") point away from the
// first screenful and towards a page of their own, rather than lower on
// the same one: a phone check-in never has to scroll past them to reach
// the attention queue, and this page can be revisited on its own without
// re-fetching the queue/week/money data every time. This loader is the
// pre-#234 dashboard loader's forecasting half, unchanged in substance.
import { irrevocabilityWindowEnd } from '$lib/server/fiscal/certainty';
import { evaluateActiveCeilings } from '$lib/server/fiscal/ceiling-status';
import { forecastRenewalAssumptions, forecastRevenueByMonth } from '$lib/server/fiscal/forecast';
import { fetchClientRevenueBreakdown } from '$lib/server/fiscal/revenue';
import { listClients } from '$lib/server/repositories/client';
import { listContractsWithClient } from '$lib/server/repositories/contract';
import type { CashCalendarMarker } from '$lib/dashboard/cash-calendar';
import type { PageServerLoad } from './$types';

const PAST_MONTHS = 6;
const FUTURE_MONTHS = 6;

/** `monthStart` (a `YYYY-MM-01` date) shifted by `months`, clamped to the
 * first of the resulting month — mirrors `domain/recurring-fee.ts`'s own
 * `addMonthsIso`. */
function addMonthsToMonthStart(monthStart: string, months: number): string {
	const [year, month] = monthStart.split('-').map(Number);
	const total = year * 12 + (month - 1) + months;
	return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-01`;
}

/** `date` shifted by `days`, wrapping months and years correctly — the
 * same UTC-anchored arithmetic `fiscal/ceiling.ts` and `fiscal/certainty.ts`
 * each keep their own copy of. */
function addDaysIso(date: string, days: number): string {
	const parsed = new Date(`${date}T00:00:00Z`);
	parsed.setUTCDate(parsed.getUTCDate() + days);
	return parsed.toISOString().slice(0, 10);
}

export const load: PageServerLoad = async () => {
	const now = new Date();
	const today = now.toISOString().slice(0, 10);
	const currentMonthStart = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
	const windowFrom = addMonthsToMonthStart(currentMonthStart, -PAST_MONTHS);
	const windowTo = addMonthsToMonthStart(currentMonthStart, FUTURE_MONTHS);
	const currentYear = Number(today.slice(0, 4));
	const yearFrom = `${currentYear}-01-01`;
	const yearTo = `${currentYear + 1}-01-01`;

	const [evaluatedCeilings, monthly, contracts, clientRevenue, clients, calendarAssumptions] =
		await Promise.all([
			evaluateActiveCeilings(today),
			forecastRevenueByMonth(today, windowFrom, windowTo),
			listContractsWithClient(),
			fetchClientRevenueBreakdown(yearFrom, yearTo),
			listClients(),
			// #127: every recorded renewal assumption paired with the figure
			// it contributes to the calendar's own rolling window.
			forecastRenewalAssumptions(today, windowFrom, windowTo)
		]);

	// #58 — vertical markers for contractual dates: a contract's own
	// expiry, the renewal-notice window opening, and the irrevocability
	// window's own edge, whichever fall inside the rolling window. A
	// draft contract is not yet a commitment, so it carries none.
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
	// share ceiling in force, pack or contract origin alike.
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
		cashCalendar: {
			from: windowFrom,
			to: windowTo,
			months: monthly,
			markers,
			assumptions: calendarAssumptions
				.filter((row) => row.contribution > 0)
				.map((row) => ({
					contractId: row.contractId,
					contractTitle: row.contractTitle,
					probability: row.assumption.probability,
					expectedVolumeMinorUnits: row.assumption.expectedVolumeMinorUnits,
					horizonEndsOn: row.assumption.horizonEndsOn,
					contributionMinorUnits: row.contribution
				}))
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
