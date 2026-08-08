// The database side of the ledger (#37): fetches `invoice` rows and hands
// them to the pure functions in `ledger.ts`. Accepts either the pool or an
// open transaction (`DbExecutor`), so tests can run inside the transaction
// they are about to roll back — the same pattern `fiscal/profile.ts` sets.

import { eq } from 'drizzle-orm';
import { db, type DbExecutor } from '$lib/server/db';
import { contract, invoice } from '$lib/server/db/schema';
import { defaultRegistry, type PackRegistry } from './registry';
import { resolveFiscalPackOverRange } from './profile';
import type { MinorUnits } from '$lib/money';
import {
	sumLedgerAcrossPeriods,
	type LedgerPeriod,
	type LedgerRegimeFigure,
	type LedgerRow
} from './ledger';

/**
 * Every invoice as one ledger row: `amount` is `taxable_amount +
 * social_charge` — VAT (`tax_amount`) and stamp duty are pass-through,
 * never the practitioner's own revenue, and the social-security surcharge
 * counts towards it despite not being taxable income (see
 * `it-flat-rate.ts`'s header comment on why, and `invoice.ts`'s totals
 * trigger for why `total = taxable_amount + tax_amount + stamp_duty +
 * social_charge` always holds). This is the one query that assembles a
 * `LedgerRow`; every ceiling, certainty and forecast figure reads through
 * it, never the raw table again.
 */
export async function fetchLedgerRows(executor: DbExecutor = db): Promise<LedgerRow[]> {
	const rows = await executor
		.select({
			invoiceId: invoice.id,
			contractId: invoice.contractId,
			clientId: contract.clientId,
			issueDate: invoice.issueDate,
			paidOn: invoice.paidOn,
			taxableAmount: invoice.taxableAmount,
			socialCharge: invoice.socialCharge
		})
		.from(invoice)
		.innerJoin(contract, eq(invoice.contractId, contract.id));

	return rows.map((row) => ({
		invoiceId: row.invoiceId,
		contractId: row.contractId,
		clientId: row.clientId,
		issueDate: row.issueDate,
		paidOn: row.paidOn,
		amount: row.taxableAmount + (row.socialCharge ?? 0)
	}));
}

/** The regime-aware sub-periods `[from, to)` resolves to — the one piece
 * `fetchRevenueOverRange` and `fetchClientRevenueBreakdown` share, so a
 * regime change inside the range is read the same way regardless of which
 * one is asking. */
async function resolveLedgerPeriods(
	from: string,
	to: string,
	executor: DbExecutor,
	registry: PackRegistry
): Promise<LedgerPeriod[]> {
	const resolvedPeriods = await resolveFiscalPackOverRange(executor, from, to, registry);
	return resolvedPeriods.map((period) => ({
		basis: period.pack.basis,
		from: period.from,
		to: period.to ?? to,
		packId: period.pack.id,
		unresolvedRevenue: period.pack.unresolvedRevenue
	}));
}

/**
 * Revenue over `[from, to)`, correct across a regime change inside the
 * range (#37's central acceptance bullet): each sub-period is read under
 * the pack that actually applied to it (`resolveFiscalPackOverRange`),
 * cash or accrual as that pack declares, combined by
 * `sumLedgerAcrossPeriods` — never a second summation loop with its own
 * basis logic.
 */
export async function fetchRevenueOverRange(
	from: string,
	to: string,
	executor: DbExecutor = db,
	registry: PackRegistry = defaultRegistry
): Promise<LedgerRegimeFigure> {
	const [rows, periods] = await Promise.all([
		fetchLedgerRows(executor),
		resolveLedgerPeriods(from, to, executor, registry)
	]);
	return sumLedgerAcrossPeriods(rows, periods);
}

/** One client's own revenue over `[from, to)`, part of a
 * `ClientRevenueBreakdown`. */
export interface ClientRevenueShare {
	readonly clientId: string;
	readonly amount: MinorUnits;
}

/** Revenue over `[from, to)`, split by client (#59's concentration
 * screen), alongside the same total `fetchRevenueOverRange` would give
 * for the whole practice. */
export interface ClientRevenueBreakdown {
	readonly from: string;
	readonly to: string;
	readonly total: MinorUnits;
	readonly byClient: readonly ClientRevenueShare[];
}

/**
 * `fetchRevenueOverRange`, split per client (#59): the same regime-aware
 * reading, `rows` filtered to one client before `sumLedgerAcrossPeriods`
 * runs for each — never a second summation loop with its own basis logic,
 * and the sub-period resolution (`resolveLedgerPeriods`) happens once and
 * is shared across every client rather than repeated per client. A client
 * with no revenue in the range is left out of `byClient` rather than
 * listed at zero.
 */
export async function fetchClientRevenueBreakdown(
	from: string,
	to: string,
	executor: DbExecutor = db,
	registry: PackRegistry = defaultRegistry
): Promise<ClientRevenueBreakdown> {
	const [rows, periods] = await Promise.all([
		fetchLedgerRows(executor),
		resolveLedgerPeriods(from, to, executor, registry)
	]);
	const clientIds = [...new Set(rows.map((row) => row.clientId))];
	const byClient = clientIds
		.map((clientId) => ({
			clientId,
			amount: sumLedgerAcrossPeriods(
				rows.filter((row) => row.clientId === clientId),
				periods
			).amount
		}))
		.filter((share) => share.amount > 0);

	return { from, to, total: sumLedgerAcrossPeriods(rows, periods).amount, byClient };
}
