// The home screen (#234): an attention queue, not a mini BI dashboard.
// Three widgets, each reading a query surface that already exists rather
// than recomputing a figure here — the same discipline the widgets this
// screen replaces already followed. All amounts assume a single practice
// currency (EUR) — the same simplification `fiscal/ledger.ts`'s
// `LedgerRow` already makes by carrying no currency of its own. Charts
// (cash calendar, client concentration) moved to `/reports` (#234's own
// "the charts move below, or to their own page" — see that route's
// header comment for why a separate page rather than a lower section).
import { getLocale } from '$lib/paraglide/runtime';
import { evaluateActiveCeilings } from '$lib/server/fiscal/ceiling-status';
import { addMinorUnits, NO_MINOR_UNITS, sumMinorUnits, type MinorUnits } from '$lib/money';
import { daysLate } from '$lib/server/domain/invoice';
import { priceWorkUnitOnDate } from '$lib/server/domain/work-unit-pricing';
import {
	forecastRenewalAssumptions,
	forecastRevenue,
	type ContractRenewalAssumptionForecast
} from '$lib/server/fiscal/forecast';
import { listRateCards } from '$lib/server/repositories/rate-card';
import { listUnpaidInvoices } from '$lib/server/repositories/invoice';
import { listWorkUnitsBetween } from '$lib/server/repositories/work-unit';
import { listProposals } from '$lib/server/repositories/proposal';
import { listActiveAlerts } from '$lib/server/alerts/engine';
import { buildAttentionRows, type AttentionRow } from '$lib/server/dashboard/attention';
import * as m from '$lib/paraglide/messages';
import { selectGoverningCeilingIds, type CeilingView } from '$lib/dashboard/ceiling';
import type { RenewalAssumptionContribution } from '$lib/dashboard/renewal-assumption';
import { pendingProposalDay, pendingProposalsSummary } from '$lib/dashboard/proposals-summary';
import {
	monthBounds,
	summarizeWorkUnitsByState,
	weekDates,
	type PricedWorkUnit
} from '$lib/dashboard/week';
import type { PageServerLoad } from './$types';

/** #127: `forecastRenewalAssumptions`'s own return shape, narrowed to the
 * contracts that actually contribute a positive figure over whichever
 * window the caller asked it for — the ceiling meter runs this same
 * filter/reshape, never a second fiscal calculation. */
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

const APPROVED_AWAITING_WORK_STATES = ['approved'];
// A day is "worked this month" once it has actually happened, whether or
// not the paperwork behind it has caught up — `worked_without_approval`
// still counts (it is worked; that is exactly why it is also, separately,
// a critical attention row), through `disputed`, `invoiced` and `paid`.
const WORKED_THIS_MONTH_STATES = [
	'worked',
	'worked_without_approval',
	'disputed',
	'invoiced',
	'paid'
];

// / is protected by the default guard (src/hooks.server.ts), so locals.user
// is always set here: an unauthenticated request never reaches this load.
export const load: PageServerLoad = async ({ locals }) => {
	const locale = getLocale();
	const now = new Date();
	const today = now.toISOString().slice(0, 10);
	const week = weekDates(today);
	const { start: monthStart, end: monthEnd } = monthBounds(today);
	// A week can straddle a month boundary; one query covers both windows
	// rather than two overlapping ones.
	const rangeFrom = week[0] < monthStart ? week[0] : monthStart;
	const rangeTo = week[6] > monthEnd ? week[6] : monthEnd;

	const [alerts, pendingProposals, rangeWorkUnits, evaluatedCeilings, unpaidInvoices] =
		await Promise.all([
			listActiveAlerts(today),
			listProposals('pending'),
			listWorkUnitsBetween(rangeFrom, rangeTo),
			evaluateActiveCeilings(today),
			listUnpaidInvoices()
		]);

	// #234's "this week" strip: approved-but-unworked and already-worked
	// backlog for the current month, priced the same way `day/calendar`'s
	// own loader prices a month (`priceWorkUnitOnDate` against whichever
	// rate card is in force on the day's own date — never a second
	// pricing rule).
	const contractIds = [...new Set(rangeWorkUnits.map((row) => row.contractId))];
	const rateCardsByContract = new Map(
		await Promise.all(
			contractIds.map(async (contractId) => [contractId, await listRateCards(contractId)] as const)
		)
	);
	const pricedWorkUnits: PricedWorkUnit[] = rangeWorkUnits.map((row) => {
		const quantity = Number(row.quantity);
		return {
			date: row.date,
			state: row.state,
			quantity,
			amount: (priceWorkUnitOnDate(
				{ date: row.date, quantity },
				rateCardsByContract.get(row.contractId) ?? []
			) ?? NO_MINOR_UNITS) as MinorUnits
		};
	});
	const monthWorkUnits = pricedWorkUnits.filter(
		(row) => row.date >= monthStart && row.date <= monthEnd
	);
	const approvedAwaitingWork = summarizeWorkUnitsByState(
		monthWorkUnits,
		APPROVED_AWAITING_WORK_STATES
	);
	const workedThisMonth = summarizeWorkUnitsByState(monthWorkUnits, WORKED_THIS_MONTH_STATES);
	const weekEntryDates = new Set(
		pricedWorkUnits.filter((row) => week.includes(row.date)).map((row) => row.date)
	);

	// #234's attention queue: WWA/overdue-invoice/ceiling alerts, reusing
	// `alertResolution` (#220) rather than a second link/action mapping,
	// plus one synthetic row for proposals still pending — not an
	// `AlertDetail` at all, so the alert engine has nothing to detect.
	const pendingProposalDays = pendingProposals
		.map((row) => pendingProposalDay(row.proposedFields))
		.filter((day) => day !== null);
	const pendingProposalsRow: AttentionRow | null =
		pendingProposals.length > 0
			? {
					key: 'pending-proposals',
					severity: 'info',
					title: m.dashboard_attention_proposals_title({ count: pendingProposals.length }),
					body: pendingProposalsSummary(pendingProposalDays, locale),
					subjectHref: '/proposals',
					subjectLabel: m.dashboard_attention_action_review(),
					actionHref: '/proposals',
					actionLabel: m.dashboard_attention_action_review()
				}
			: null;
	const attentionRows = buildAttentionRows(alerts, locale, pendingProposalsRow);

	// #234's money section — what is owed: every currently unpaid
	// invoice, most urgent first, the same `daysLate` recomputation
	// `routes/invoices/+page.server.ts` uses so the two screens never
	// disagree about how late something is. `total` is the remaining
	// balance (#212), never the invoice's full original total — a
	// partly paid invoice shows what is actually still owed.
	const invoiceRows = unpaidInvoices
		.map((row) => ({
			id: row.invoice.id,
			number: row.invoice.number,
			clientLegalName: row.clientLegalName,
			dueDate: row.invoice.dueDate,
			daysLate: daysLate(row.invoice.dueDate, now),
			total: row.balance.remaining,
			currency: row.invoice.currency
		}))
		.sort((a, b) => b.daysLate - a.daysLate);

	// #234's single ceiling card — #57 used to render one card per
	// pack-origin, whole-practice ceiling, and the flat-rate regime's
	// soft/hard pair (same `currentValue`, two limits) rendered as two
	// visually identical siblings. `selectGoverningCeilingIds` collapses
	// each shared-basis group to its one governing limit; across
	// different bases (not exercised by any pack this codebase ships,
	// but not ruled out by the ceiling model either) the worst-off one —
	// highest usage ratio — is shown, since the home screen carries only
	// one ceiling card.
	const heroCeilings = evaluatedCeilings.filter(
		(evaluated) =>
			evaluated.ceiling.origin === 'pack' && evaluated.ceiling.perimeter.kind === 'all_clients'
	);
	const governingIds = selectGoverningCeilingIds(
		heroCeilings.map((evaluated) => ({
			id: evaluated.ceiling.id,
			basis: evaluated.ceiling.basis,
			limitValue: evaluated.limitValue,
			crossed: evaluated.crossed
		}))
	);
	const governing = heroCeilings
		.filter((evaluated) => governingIds.has(evaluated.ceiling.id))
		.sort((a, b) => b.usageRatio - a.usageRatio)[0];

	let ceiling: CeilingView | null = null;
	if (governing) {
		const [projection, assumptions] = await Promise.all([
			forecastRevenue(today, today, governing.period.to),
			forecastRenewalAssumptions(today, today, governing.period.to)
		]);
		ceiling = {
			id: governing.ceiling.id,
			label: governing.ceiling.label,
			basis: governing.ceiling.basis,
			periodFrom: governing.period.from,
			periodTo: governing.period.to,
			currentValue: governing.currentValue,
			limitValue: governing.limitValue,
			usageRatio: governing.usageRatio,
			crossed: governing.crossed,
			alertLevels: governing.ceiling.alertLevels,
			activeAlertLevels: governing.activeAlertLevels,
			consequence: governing.ceiling.consequence,
			// The dashed year-end projection: cash already in hand plus
			// what's committed and projected between today and the
			// period's own end — the two figures `forecast.ts` already
			// exports, added once, never a second forecast by hand.
			projectedEnd: addMinorUnits(
				governing.currentValue,
				projection.committed.amount,
				projection.projected.amount
			),
			assumptions: toAssumptionViews(assumptions)
		};
	}

	return {
		user: locals.user!,
		today,
		// #64: the record-day CTA's sibling — how many proposals are
		// waiting, so the one tap to `/proposals` carries context before
		// it's even taken.
		pendingProposalsCount: pendingProposals.length,
		attentionRows,
		week: {
			dates: week,
			entryDates: [...weekEntryDates],
			approvedAwaitingWork: {
				count: approvedAwaitingWork.count,
				totalDays: approvedAwaitingWork.totalDays,
				valueMinorUnits: approvedAwaitingWork.valueMinorUnits,
				sampleDates: approvedAwaitingWork.sampleDates
			},
			pendingProposalDays,
			workedThisMonth: {
				count: workedThisMonth.count,
				valueMinorUnits: workedThisMonth.valueMinorUnits
			}
		},
		money: {
			invoices: invoiceRows,
			totalOutstanding: sumMinorUnits(invoiceRows.map((row) => row.total)),
			overdueCount: invoiceRows.filter((row) => row.daysLate > 0).length,
			ceiling
		}
	};
};
