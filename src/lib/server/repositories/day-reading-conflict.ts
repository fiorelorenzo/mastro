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
 * again, so a stale row cannot keep an alert alive after the disagreement is
 * over. Three callers, and the third is the one worth knowing about: the
 * producer clears a date whose reading now matches the ledger and a date it
 * re-proposes, and `applyProposal` clears the date a human accepts. Without
 * that last one, accepting a proposal whose date carried a "the reading says
 * nothing here" row left behind a contradiction alert nobody could ever
 * silence, because that alert resolves itself by comparing a reading
 * quantity which in such a row is null. */
export async function clearDayReadingConflict(
	contractId: string,
	date: string,
	executor: DbExecutor = db
): Promise<void> {
	await executor
		.delete(dayReadingConflict)
		.where(and(eq(dayReadingConflict.contractId, contractId), eq(dayReadingConflict.date, date)));
}
