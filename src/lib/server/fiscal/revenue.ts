// The database side of the ledger (#37): fetches `invoice` rows and hands
// them to the pure functions in `ledger.ts`. Accepts either the pool or an
// open transaction (`DbExecutor`), so tests can run inside the transaction
// they are about to roll back — the same pattern `fiscal/profile.ts` sets.

import { eq } from 'drizzle-orm';
import { db, type DbExecutor } from '$lib/server/db';
import { contract, invoice } from '$lib/server/db/schema';
import { defaultRegistry, type PackRegistry } from './registry';
import { resolveFiscalPackOverRange } from './profile';
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
	const [rows, resolvedPeriods] = await Promise.all([
		fetchLedgerRows(executor),
		resolveFiscalPackOverRange(executor, from, to, registry)
	]);
	const periods: LedgerPeriod[] = resolvedPeriods.map((period) => ({
		basis: period.pack.basis,
		from: period.from,
		to: period.to ?? to,
		packId: period.pack.id
	}));
	return sumLedgerAcrossPeriods(rows, periods);
}
