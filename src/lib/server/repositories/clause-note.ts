import { asc, eq } from 'drizzle-orm';
import { db, type DbExecutor } from '$lib/server/db';
import { clauseNote } from '$lib/server/db/schema';

export type ClauseNoteInput = {
	contractId: string;
	clauseReference: string;
	verbatimText: string;
	interpretationAdopted: string;
	notes: string | null;
};

export async function listClauseNotes(contractId: string, executor: DbExecutor = db) {
	return executor.query.clauseNote.findMany({
		where: eq(clauseNote.contractId, contractId),
		orderBy: asc(clauseNote.createdAt)
	});
}

export async function getClauseNote(id: string) {
	return db.query.clauseNote.findFirst({ where: eq(clauseNote.id, id) });
}

export async function createClauseNote(input: ClauseNoteInput, executor: DbExecutor = db) {
	const [row] = await executor.insert(clauseNote).values(input).returning();
	return row;
}

export async function updateClauseNote(id: string, input: ClauseNoteInput) {
	const [row] = await db.update(clauseNote).set(input).where(eq(clauseNote.id, id)).returning();
	return row;
}
