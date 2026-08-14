// Client exposure (#242): "who owes me and how exposed am I to them" —
// entirely a reuse of pieces the fiscal engine and the invoice repository
// already expose (`fiscal/ledger.ts`, `fiscal/ceiling-status.ts`,
// `repositories/invoice.ts`, `repositories/work-unit.ts`), assembled once
// so the client list and the client detail page read the same numbers
// rather than each computing its own.
//
// Basis, deliberately, per the audit's own warning: outstanding and
// collected-this-year are the gross figure a client actually owes or paid
// (`listInvoiceTotalsByClient`'s `total` — VAT and stamp duty included,
// the same one `/invoices`'s own ageing list already sums), read as an
// accrual question (issued, regardless of payment) and a cash question
// (paid, within the year) respectively — not the fiscal ledger's own net
// revenue figure. Revenue share reads the ledger on its `'accrual'`
// basis (`sumLedger`), which is *not* the dashboard's own concentration
// widget: that one reads the active fiscal pack's basis (cash, under the
// seeded flat-rate regime) because it answers a tax question. "Who owes
// me" is answered on invoiced revenue instead — which also happens to be
// exactly the basis a contract's own concentration cap is defined on in
// this codebase (`ceiling.basis`, independent of the active pack), so a
// client's badge here and its share figure are always the same number,
// never two that could quietly disagree.
import { db, type DbExecutor } from '$lib/server/db';
import { NO_MINOR_UNITS, sumMinorUnits, type MinorUnits } from '$lib/money';
import { listInvoiceTotalsByClient } from '$lib/server/repositories/invoice';
import { countWorkedDaysByClientForYear } from '$lib/server/repositories/work-unit';
import { evaluateActiveCeilings } from './ceiling-status';
import type { EvaluatedCeiling } from './ceiling';
import { fetchLedgerRows } from './revenue';
import { sumLedger } from './ledger';

export interface ClientExposure {
	readonly clientId: string;
	/** Accrual — every invoice issued to this client and not yet paid. */
	readonly outstanding: MinorUnits;
	/** Cash — every invoice this client paid within the current calendar year. */
	readonly collectedThisYear: MinorUnits;
	/** Not fiscal: work-unit rows that actually happened this calendar year. */
	readonly daysThisYear: number;
	/** Accrual — this client's own invoiced revenue this year over every
	 *  client's, 0 with no revenue at all this year yet. */
	readonly revenueShareThisYear: number;
	/** This client's own contract concentration cap, evaluated exactly as
	 *  `fiscal/ceiling-status.ts` evaluates it for the dashboard — `null`
	 *  when no `percentage_share`/`client`-perimeter ceiling names them. */
	readonly concentrationCap: EvaluatedCeiling | null;
}

/** Every `percentage_share` ceiling anchored to one client, keyed by that
 *  client's id — the narrowing lives here once rather than at each of
 *  `evaluatedCeilings`'s two read sites below. */
function indexClientCeilingsByClientId(
	evaluatedCeilings: readonly EvaluatedCeiling[]
): ReadonlyMap<string, EvaluatedCeiling> {
	const byClientId = new Map<string, EvaluatedCeiling>();
	for (const evaluated of evaluatedCeilings) {
		if (evaluated.ceiling.measure !== 'percentage_share') continue;
		const perimeter = evaluated.ceiling.perimeter;
		if (perimeter.kind !== 'client') continue;
		byClientId.set(perimeter.clientId, evaluated);
	}
	return byClientId;
}

/**
 * One `ClientExposure` per client with any invoice, work-unit, or
 * revenue-share activity — a client with none of those is simply absent
 * from the returned map; the caller (a page load) is what knows the full
 * client list and renders such a client's own designed empty state
 * rather than this module inventing an all-zero row nobody asked for.
 */
export async function listClientExposures(
	asOfDate: string,
	executor: DbExecutor = db
): Promise<ReadonlyMap<string, ClientExposure>> {
	const currentYear = Number(asOfDate.slice(0, 4));
	const yearFrom = `${currentYear}-01-01`;
	const yearTo = `${currentYear + 1}-01-01`;

	const [invoiceTotals, dayCounts, ledgerRows, evaluatedCeilings] = await Promise.all([
		listInvoiceTotalsByClient(executor),
		countWorkedDaysByClientForYear(yearFrom, yearTo, executor),
		fetchLedgerRows(executor),
		evaluateActiveCeilings(asOfDate, executor)
	]);

	const totalRevenueThisYear = sumLedger(ledgerRows, 'accrual', yearFrom, yearTo).amount;
	const capByClientId = indexClientCeilingsByClientId(evaluatedCeilings);

	const clientIds = new Set<string>();
	for (const row of invoiceTotals) clientIds.add(row.clientId);
	for (const row of dayCounts) clientIds.add(row.clientId);
	for (const row of ledgerRows) clientIds.add(row.clientId);

	const result = new Map<string, ClientExposure>();
	for (const clientId of clientIds) {
		const outstanding = sumMinorUnits(
			invoiceTotals.filter((row) => row.clientId === clientId).map((row) => row.balance.remaining)
		);
		const collectedThisYear = sumMinorUnits(
			invoiceTotals
				.filter((row) => row.clientId === clientId)
				.flatMap((row) => row.payments)
				.filter((p) => p.date >= yearFrom && p.date < yearTo)
				.map((p) => p.amount)
		);
		const daysThisYear = dayCounts.find((row) => row.clientId === clientId)?.days ?? 0;
		const clientRevenueThisYear = sumLedger(
			ledgerRows.filter((row) => row.clientId === clientId),
			'accrual',
			yearFrom,
			yearTo
		).amount;
		const revenueShareThisYear =
			totalRevenueThisYear === 0 ? 0 : clientRevenueThisYear / totalRevenueThisYear;

		result.set(clientId, {
			clientId,
			outstanding,
			collectedThisYear,
			daysThisYear,
			revenueShareThisYear,
			concentrationCap: capByClientId.get(clientId) ?? null
		});
	}
	return result;
}

/** Every figure at zero and no cap — the exposure of a client this module
 *  never saw any activity for. A page load pairs this with the client's
 *  own "no contracts, no invoices" check to decide whether to render it
 *  at all or fall back to a designed empty state (#242's acceptance). */
export function emptyClientExposure(clientId: string): ClientExposure {
	return {
		clientId,
		outstanding: NO_MINOR_UNITS,
		collectedThisYear: NO_MINOR_UNITS,
		daysThisYear: 0,
		revenueShareThisYear: 0,
		concentrationCap: null
	};
}
