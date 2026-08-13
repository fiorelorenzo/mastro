import { and, asc, eq } from 'drizzle-orm';
import { db, type DbExecutor } from '$lib/server/db';
import {
	approval,
	document,
	type ApprovalOrigin,
	type TransitionActor
} from '$lib/server/db/schema';
import type { DocumentProvenance } from '$lib/server/db/schema/document';
import { storeDocument } from './document';
import { linkApprovalToWorkUnit } from './work-unit';

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

export type ApprovalForDocumentInput = Omit<ApprovalInput, 'document'> & { documentId: string };

/**
 * Records an approval whose proof is a document that already exists —
 * the mail-ingested original a proposal (#209) rests on, archived by
 * `mail/poll.ts` and owned by the contract until something downstream
 * decides what it specifically evidences (see that file's own comment on
 * `ownerType: 'contract'`). Unlike `createApproval`, this never calls
 * `storeDocument`: the message was already archived once at ingestion,
 * and archiving it again would leave two rows — one of them nobody's
 * original — for content that is otherwise only deduplicated on disk,
 * not in Postgres. The document is re-pointed at the new approval the
 * same way a freshly archived one is.
 */
export async function createApprovalForDocument(input: ApprovalForDocumentInput, tx?: DbExecutor) {
	const run = async (executor: DbExecutor) => {
		const [approvalRow] = await executor
			.insert(approval)
			.values({
				contractId: input.contractId,
				channel: input.channel,
				sender: input.sender,
				receivedAt: input.receivedAt,
				messageId: input.messageId,
				documentId: input.documentId,
				excerpt: input.excerpt,
				origin: input.origin
			})
			.returning();

		await executor
			.update(document)
			.set({ ownerType: 'approval', ownerId: approvalRow.id })
			.where(eq(document.id, input.documentId));

		return approvalRow;
	};

	return tx ? run(tx) : db.transaction(run);
}

export type RecordApprovalLink = {
	/** The day this approval is being recorded for — on a day sitting in
	 * `worked_without_approval` this is #210's whole point: it recovers
	 * the day in the same transaction as archiving the proof, rather than
	 * as a second request a crash in between could split. */
	workUnitId: string;
	actor: TransitionActor;
	reason: string;
};

/**
 * `createApproval`, plus — when `link` is given — `linkApprovalToWorkUnit`
 * in the same transaction (#210). `linkApprovalToWorkUnit` already does the
 * actual recovery: the state machine trigger in `drizzle/0038` promotes a
 * `worked_without_approval` row to `worked` the moment `approval_id` stops
 * being null. This function exists only so the human path — record what
 * arrived by phone, WhatsApp, a signed scan or in a meeting — archives the
 * proof and links the day atomically, the same guarantee `createApproval`
 * itself already gives the document/approval pair.
 *
 * Trusts `link`, the same way `linkApprovalToWorkUnit` and
 * `transitionWorkUnit` trust their own callers (see those doc comments):
 * the `/approvals/new` form checks the named day belongs to this contract
 * and has no approval yet before ever calling this, so a mismatch here
 * would mean a stale or tampered request, not a case this function tries
 * to pre-validate.
 */
export async function recordApproval(
	input: ApprovalInput,
	link: RecordApprovalLink | null,
	tx?: DbExecutor
) {
	const run = async (executor: DbExecutor) => {
		const approvalRow = await createApproval(input, executor);
		if (link) {
			await linkApprovalToWorkUnit(
				link.workUnitId,
				approvalRow.id,
				link.actor,
				link.reason,
				executor
			);
		}
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
