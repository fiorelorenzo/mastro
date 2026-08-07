// The database side of the ceiling engine (#36): resolves the active pack,
// fetches every persisted contract ceiling, and evaluates all of them —
// pack and contract origin alike — through `evaluateCeiling`, the one
// function `fiscal/ceiling.ts` exports for exactly this reason.

import { db, type DbExecutor } from '$lib/server/db';
import { listCeilingsWithContract } from '$lib/server/repositories/ceiling';
import { ceilingFromContractRow, evaluateCeiling, type EvaluatedCeiling } from './ceiling';
import type { Ceiling } from './pack';
import { resolveActiveFiscalPack } from './profile';
import { defaultRegistry, type PackRegistry } from './registry';
import { fetchLedgerRows } from './revenue';

interface CeilingWithAnchor {
	readonly ceiling: Ceiling;
	/** Only set for a contract ceiling — the one piece `evaluateCeiling`
	 * needs beyond the ceiling itself, and only when its own basis is
	 * `'cash_received_contract_year'`. */
	readonly contractStartsOn?: string;
}

/**
 * Every ceiling in force on `asOfDate`, evaluated — the pack's own
 * (`resolveActiveFiscalPack(...).pack.ceilings`, empty the moment a
 * fiscal profile with no ceilings is active) alongside every persisted
 * contract ceiling (`listCeilingsWithContract`), through the exact same
 * `evaluateCeiling` call. This is the query surface a dashboard (#57) and
 * the alert engine (#74) read: one array, each entry already carrying its
 * period, current value, limit, usage ratio and active alert levels.
 */
export async function evaluateActiveCeilings(
	asOfDate: string,
	executor: DbExecutor = db,
	registry: PackRegistry = defaultRegistry
): Promise<EvaluatedCeiling[]> {
	const [resolved, contractCeilingRows, rows] = await Promise.all([
		resolveActiveFiscalPack(executor, asOfDate, registry),
		listCeilingsWithContract(executor),
		fetchLedgerRows(executor)
	]);

	const packEntries: CeilingWithAnchor[] = (resolved?.pack.ceilings ?? []).map((ceiling) => ({
		ceiling
	}));
	const contractEntries: CeilingWithAnchor[] = contractCeilingRows.map((row) => ({
		ceiling: ceilingFromContractRow(row, row.contract.clientId),
		contractStartsOn: row.contract.startsOn
	}));

	return [...packEntries, ...contractEntries].map(({ ceiling, contractStartsOn }) =>
		evaluateCeiling(ceiling, rows, asOfDate, contractStartsOn)
	);
}
