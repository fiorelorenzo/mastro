import { and, eq } from 'drizzle-orm';
import { db, type DbExecutor } from '$lib/server/db';
import { dayReadingConflict } from '$lib/server/db/schema';

export interface DayReadingConflictInput {
	readonly contractId: string;
	readonly date: string;
	readonly documentId: string;
	readonly extractionRunId: string | null;
	/** Null when the newest reading proposes nothing for this date. */
	readonly proposedFields: Record<string, unknown> | null;
	readonly excerpt: string | null;
}

/** Upserts the newest disagreeing reading for one day. */
export async function recordDayReadingConflict(
	input: DayReadingConflictInput,
	executor: DbExecutor = db
): Promise<void> {
	await executor
		.insert(dayReadingConflict)
		.values(input)
		.onConflictDoUpdate({
			target: [dayReadingConflict.contractId, dayReadingConflict.date],
			set: {
				documentId: input.documentId,
				extractionRunId: input.extractionRunId,
				proposedFields: input.proposedFields,
				excerpt: input.excerpt
			}
		});
}

/** Drops the conflict for a day, for when the ledger and the reading agree
 * again — the producer calls this so a stale row cannot keep an alert alive
 * after the disagreement is over. */
export async function clearDayReadingConflict(
	contractId: string,
	date: string,
	executor: DbExecutor = db
): Promise<void> {
	await executor
		.delete(dayReadingConflict)
		.where(and(eq(dayReadingConflict.contractId, contractId), eq(dayReadingConflict.date, date)));
}
