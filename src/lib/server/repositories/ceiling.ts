import { asc, eq } from 'drizzle-orm';
import type { LegalText } from '$lib/legal/legal-text';
import { db, type DbExecutor } from '$lib/server/db';
import { ceiling } from '$lib/server/db/schema';
import type { LabelBundle } from '$lib/server/fiscal/label';
import type { CeilingAlertLevel, CeilingBasis, CeilingLimit } from '$lib/server/fiscal/pack';

export type CeilingInput = {
	contractId: string;
	code: string;
	label: LabelBundle;
	legalBasis: LegalText | null;
	basis: CeilingBasis;
	alertLevels: readonly CeilingAlertLevel[];
	consequence: LabelBundle;
} & CeilingLimit;

function toRow(input: CeilingInput) {
	return {
		contractId: input.contractId,
		code: input.code,
		label: input.label,
		legalBasis: input.legalBasis,
		basis: input.basis,
		alertLevels: input.alertLevels,
		consequence: input.consequence,
		measure: input.measure,
		absoluteValueMinorUnits: input.measure === 'absolute_amount' ? input.value : null,
		shareRatio: input.measure === 'percentage_share' ? input.value : null
	};
}

export async function createCeiling(input: CeilingInput, executor: DbExecutor = db) {
	const [row] = await executor.insert(ceiling).values(toRow(input)).returning();
	return row;
}

export async function listCeilingsByContract(contractId: string, executor: DbExecutor = db) {
	return executor.query.ceiling.findMany({
		where: eq(ceiling.contractId, contractId),
		orderBy: asc(ceiling.code)
	});
}

/**
 * Every contract ceiling with the two fields off its own contract the
 * evaluator needs to anchor it (#36): `clientId` for `perimeter`
 * (`ceilingFromContractRow` in `fiscal/ceiling.ts`), `startsOn` for a
 * `cash_received_contract_year` basis (`ceilingPeriod`, same file). The
 * one join `fiscal/ceiling-status.ts` reads.
 */
export async function listCeilingsWithContract(executor: DbExecutor = db) {
	return executor.query.ceiling.findMany({
		with: { contract: { columns: { clientId: true, startsOn: true } } }
	});
}

export async function getCeiling(id: string, executor: DbExecutor = db) {
	return executor.query.ceiling.findFirst({ where: eq(ceiling.id, id) });
}

export async function updateCeiling(id: string, input: CeilingInput, executor: DbExecutor = db) {
	const [row] = await executor
		.update(ceiling)
		.set(toRow(input))
		.where(eq(ceiling.id, id))
		.returning();
	return row;
}
