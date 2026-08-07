import { and, asc, eq } from 'drizzle-orm';
import { db, type DbExecutor } from '$lib/server/db';
import { approval, document, type ApprovalOrigin } from '$lib/server/db/schema';
import type { DocumentProvenance } from '$lib/server/db/schema/document';
import { storeDocument } from './document';

export type ApprovalInput = {
	contractId: string;
	channel: (typeof approval.$inferInsert)['channel'];
	sender: string;
	receivedAt: Date;
	messageId: string | null;
	excerpt: string;
	origin: ApprovalOrigin;
	document: {
		bytes: Uint8Array;
		mime: string;
		originalName: string;
		provenance: DocumentProvenance;
		confidential: boolean;
	};
};

/**
 * Archives the approval's proof and records the approval, atomically. The
 * document is inserted first, owned by the contract — the approval it will
 * end up evidencing does not exist yet, and its own `documentId` cannot be
 * set to a document that does not exist either, so neither row can be
 * written first with its final, fully-linked shape. Once the approval
 * exists, the document is re-pointed at it (`ownerType`/`ownerId` are the
 * two columns `document`'s immutability trigger leaves mutable, for
 * exactly this reason). The archived original is then reachable in one
 * direction via `approval.documentId` and in the other via
 * `listDocumentsForOwner('approval', approval.id)`.
 *
 * `tx`, if given, is used directly instead of opening a new transaction —
 * lets a caller (or a test) compose this with other writes atomically.
 */
export async function createApproval(input: ApprovalInput, tx?: DbExecutor) {
	const run = async (executor: DbExecutor) => {
		const documentRow = await storeDocument(
			{
				...input.document,
				contractId: input.contractId,
				ownerType: 'contract',
				ownerId: input.contractId
			},
			executor
		);

		const [approvalRow] = await executor
			.insert(approval)
			.values({
				contractId: input.contractId,
				channel: input.channel,
				sender: input.sender,
				receivedAt: input.receivedAt,
				messageId: input.messageId,
				documentId: documentRow.id,
				excerpt: input.excerpt,
				origin: input.origin
			})
			.returning();

		await executor
			.update(document)
			.set({ ownerType: 'approval', ownerId: approvalRow.id })
			.where(eq(document.id, documentRow.id));

		return approvalRow;
	};

	return tx ? run(tx) : db.transaction(run);
}

export async function getApproval(id: string, executor: DbExecutor = db) {
	const [row] = await executor.select().from(approval).where(eq(approval.id, id));
	return row;
}

export async function listApprovalsForContract(contractId: string, executor: DbExecutor = db) {
	return executor
		.select()
		.from(approval)
		.where(eq(approval.contractId, contractId))
		.orderBy(asc(approval.receivedAt));
}

/** The archived original for an approval, reachable in one query — the
 * forward half of #22's "reachable from the day in one click"; the
 * `work_unit` side (`getWorkUnitDocument` in `repositories/work-unit.ts`)
 * follows the day's `approvalId` to get here too. */
export async function getApprovalDocument(approvalId: string, executor: DbExecutor = db) {
	const [row] = await executor
		.select({ document })
		.from(approval)
		.innerJoin(document, eq(approval.documentId, document.id))
		.where(eq(approval.id, approvalId));
	return row?.document ?? null;
}

/** True when `documentId` names the archived original currently owned by
 * `approvalId`; used to prove reverse navigability in tests without
 * duplicating the join above. */
export async function documentBelongsToApproval(
	documentId: string,
	approvalId: string,
	executor: DbExecutor = db
) {
	const [row] = await executor
		.select({ id: document.id })
		.from(document)
		.where(
			and(
				eq(document.id, documentId),
				eq(document.ownerType, 'approval'),
				eq(document.ownerId, approvalId)
			)
		);
	return row !== undefined;
}
