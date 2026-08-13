// #83: the only place a `proposal` row is written or decided. Producing
// one (#85, #86, #87 — none of which exist yet) is `createProposal` and
// nothing more: a producer supplies `documentId`, `contractId`,
// `targetType`, `proposedFields` shaped for that target type (see
// `applyProposal` below for what each currently-supported type expects),
// `excerpt` and `confidence`. Everything after that — editing, accepting,
// rejecting — is a human decision made on the review screen
// (`routes/proposals`), never the producer's.
//
// Accepting is the "no bypass" half of invariant 3: it does not insert a
// row directly, it calls the same repository functions (`createWorkUnit`,
// `transitionWorkUnit`, `createApprovalForDocument`) a human's own form
// submissions call, inside one transaction with the proposal's own status
// update. A rejected write there — a database constraint a manual entry
// would also trip — rolls the whole thing back, proposal included, so a
// proposal can never end up marked `accepted` next to a row that was
// never actually written. `proposal.test.ts` proves this both ways: a
// valid proposal produces exactly what a human's own entry would, and an
// invalid one produces nothing at all, in either case.
//
// A `work_unit` proposal specifically writes the day already `approved`
// (#209), never merely `proposed`: the proposal exists only because a
// human wrote something approving it, which is precisely the evidence
// the `approved` state requires. `applyProposal` below creates or reuses
// the `approval` row that evidence rests on before recording the day —
// "reuses" because several proposals can share one source document (one
// email approving several days), and #209's contract is one `approval`
// per document, not one per accepted day.

import { desc, eq } from 'drizzle-orm';
import { db, type DbExecutor } from '$lib/server/db';
import { proposal, type ProposalStatus, type ProposalTargetType } from '$lib/server/db/schema';
import { parseMessage } from '$lib/server/mail/headers';
import { createApprovalForDocument } from './approval';
import { getDocument, readDocumentBytes } from './document';
import { getInboundThreadForDocument } from './inbound-thread';
import { createApprovedWorkUnit, getWorkUnit, type WorkUnitInput } from './work-unit';

export type ProposalRow = typeof proposal.$inferSelect;

export type ProposalInput = {
	documentId: string;
	contractId: string;
	targetType: ProposalTargetType;
	proposedFields: Record<string, unknown>;
	excerpt: string;
	confidence: number;
	/** The producer's own reason for a lowered confidence (#244) — see
	 * `proposal.confidenceReason`'s own doc comment. */
	confidenceReason?: string | null;
};

/**
 * Writes a proposal, first checking `input.proposedFields` against the
 * same constraints the target table would enforce on an INSERT (#245) and
 * recording what it finds on `validationError` rather than discovering it
 * later at `acceptProposal` time, after a human has already decided. See
 * `proposalValidationError` below for what "the same constraints" means.
 */
export async function createProposal(input: ProposalInput, executor: DbExecutor = db) {
	const validationError = proposalValidationError(
		input.targetType,
		input.contractId,
		input.proposedFields
	);
	const [row] = await executor
		.insert(proposal)
		.values({ ...input, validationError })
		.returning();
	return row;
}

export async function getProposal(id: string, executor: DbExecutor = db) {
	const [row] = await executor.select().from(proposal).where(eq(proposal.id, id));
	return row;
}

/** Every proposal already produced from one document. The drain's
 * idempotency check (#85): a job whose document already has proposals has
 * been applied, whatever the queue file says, so a crash between writing
 * the rows and moving the file cannot double a reviewer's work. */
export async function listProposalsForDocument(documentId: string, executor: DbExecutor = db) {
	return executor.select().from(proposal).where(eq(proposal.documentId, documentId));
}

/** Every proposal, most recent first, optionally narrowed to one status —
 * the review queue's feed (pending) and its decided history (accepted or
 * rejected) are the same query with a different filter. */
export async function listProposals(status: ProposalStatus | undefined, executor: DbExecutor = db) {
	return status
		? executor
				.select()
				.from(proposal)
				.where(eq(proposal.status, status))
				.orderBy(desc(proposal.createdAt))
		: executor.select().from(proposal).orderBy(desc(proposal.createdAt));
}

/**
 * Maps a `'work_unit'` proposal's fields onto `WorkUnitInput`, the same
 * type `work-unit-form.ts` builds from a human's own day-entry submission.
 * A producer targeting `'work_unit'` supplies `proposedFields` as
 * `{ date: string, quantity: number, scope: string, notes?: string }` —
 * `contractId` is never duplicated inside the JSON blob, it is read off
 * `proposal.contractId` itself. This only shapes the day's own fields;
 * `applyProposal` is what decides the state it lands in and the approval
 * it is linked to (#209).
 */
function workUnitInputFromFields(
	row: Pick<ProposalRow, 'contractId'>,
	fields: Record<string, unknown>
): WorkUnitInput {
	const { date, quantity, scope, notes } = fields;
	if (typeof date !== 'string') throw new Error("proposal field 'date' must be a string");
	if (typeof quantity !== 'number') throw new Error("proposal field 'quantity' must be a number");
	if (typeof scope !== 'string') throw new Error("proposal field 'scope' must be a string");
	if (notes !== undefined && notes !== null && typeof notes !== 'string') {
		throw new Error("proposal field 'notes' must be a string when present");
	}
	return { contractId: row.contractId, date, quantity, scope, notes: notes ?? null };
}

/**
 * Checks `fields` against the same constraints the target table would
 * actually enforce on an INSERT — evaluated here, at creation, rather
 * than discovered by a failed `applyProposal` after a human has already
 * clicked Accept (#245: the contract-PDF spike's `paymentTerms: {day: 0}`
 * is exactly this failure, on a target type this table does not support
 * yet). Returns what's wrong, naming the field, or null when every field
 * `applyProposal`'s own switch would read is one the table would accept.
 *
 * Deliberately narrower than a full schema: it checks only what the
 * database itself checks — types, `NOT NULL`, and the `CHECK` constraints
 * `applyProposal` would actually hit — not the business rules a
 * producer's own validation (`day-extraction.ts`'s `validateDays`, for
 * `work_unit`) already enforces before a proposal is ever created. The
 * same exhaustive `switch` as `applyProposal`, for the same reason: a new
 * target type without a case here fails to compile.
 */
function proposalValidationError(
	targetType: ProposalTargetType,
	contractId: string,
	fields: Record<string, unknown>
): string | null {
	switch (targetType) {
		case 'work_unit': {
			let input: WorkUnitInput;
			try {
				input = workUnitInputFromFields({ contractId }, fields);
			} catch (error) {
				return error instanceof Error ? error.message : String(error);
			}
			// work_unit_quantity_positive
			if (input.quantity <= 0) {
				return `quantity ${input.quantity} must be greater than 0`;
			}
			// numeric(6, 2): four digits before the point, two after.
			if (!Number.isFinite(input.quantity) || Math.abs(input.quantity) >= 10_000) {
				return `quantity ${input.quantity} does not fit the work_unit table's numeric(6,2) column`;
			}
			// A date `parseExtractedDays`'s regex would accept but is not a
			// real calendar day, e.g. 2026-02-31.
			const parsed = new Date(`${input.date}T00:00:00Z`);
			if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== input.date) {
				return `date ${input.date} is not a real date`;
			}
			return null;
		}
	}
}

/**
 * The `From:` header off a raw RFC 822 message — `applyProposal`'s only
 * source for `approval.sender` when a `work_unit` proposal is accepted
 * (#209): the archived message is the evidence, so the sender is read
 * off it directly rather than trusted from a second, separately
 * maintained copy (nothing upstream of this table records the envelope
 * sender today). Headers only, unfolded per RFC 5322 §2.2.3 (a
 * continuation line starts with whitespace); the body past the first
 * blank line is never scanned. Prefers the address inside `<...>` over
 * the header's raw value, since `"Name" <addr>` is the common shape and
 * the address is what actually identifies who wrote it.
 */
function extractSender(raw: Buffer): string {
	const value = parseMessage(raw).headers.get('from');
	if (!value) {
		throw new Error('source message has no From header to record as the approval sender');
	}
	const sender = (value.match(/<([^>]+)>/)?.[1] ?? value).trim();
	if (!sender) {
		throw new Error('source message has a blank From header');
	}
	return sender;
}

/**
 * The `approval` a `work_unit` proposal's accept writes the day against
 * (#209) — created from the proposal's own source document, or reused
 * when an earlier proposal from that same document already created one.
 * "Reused" is deliberate, not incidental: one email can produce several
 * day proposals ("ok for Thursday and Friday"), each its own `proposal`
 * row a human accepts separately, but they are one act of approval, so
 * they share one `approval` row, never one each. The search is sibling
 * proposals for the same `documentId` that are already `accepted` with a
 * `resultId` — the day that write produced — rather than anything keyed
 * on document content, since `documentId` is exactly what ties every
 * proposal from one message together (`listProposalsForDocument`).
 *
 * Building a fresh approval reads the source message's own `From` header
 * for `sender` and its `inbound_thread` row for `receivedAt`/`messageId`
 * — both facts of the envelope, never the model's. `channel` is inferred
 * from the document's own provenance: every proposal today is produced
 * from a `'mail'` document (`agent/day-producer.ts`), so this only ever
 * resolves to `'email'` in practice; `'other'` is a defensive fallback a
 * future non-mail producer would hit, not a case this table exercises yet.
 */
async function approvalForDocument(row: ProposalRow, executor: DbExecutor): Promise<string> {
	for (const sibling of await listProposalsForDocument(row.documentId, executor)) {
		if (sibling.status !== 'accepted' || !sibling.resultId) continue;
		const siblingWorkUnit = await getWorkUnit(sibling.resultId, executor);
		if (siblingWorkUnit?.approvalId) return siblingWorkUnit.approvalId;
	}

	const thread = await getInboundThreadForDocument(row.documentId, executor);
	if (!thread) {
		throw new Error(`document ${row.documentId} has no inbound thread to record an approval from`);
	}
	const sourceDocument = await getDocument(row.documentId, executor);
	if (!sourceDocument) throw new Error(`document ${row.documentId} not found`);
	const bytes = await readDocumentBytes(sourceDocument);

	const created = await createApprovalForDocument(
		{
			contractId: row.contractId,
			channel: sourceDocument.provenance === 'mail' ? 'email' : 'other',
			sender: extractSender(bytes),
			receivedAt: thread.receivedAt,
			messageId: thread.messageId,
			excerpt: row.excerpt,
			origin: { kind: 'agent', proposalReference: row.id },
			documentId: row.documentId
		},
		executor
	);
	return created.id;
}

/**
 * Writes the row `row`'s target type produces, through that type's own
 * repository function and its own database triggers — the literal
 * mechanism behind invariant 3's "no bypass". Returns the new row's id, to
 * record on `proposal.resultId`.
 *
 * A `switch` with no `default`, not an if/else: `row.targetType` is typed
 * `ProposalTargetType`, so widening that union (#86 adding `'contract'`,
 * #87 adding `'invoice'`) without adding the matching case here fails to
 * compile, the same guarantee `no-country-logic.test.ts` gives the fiscal
 * packs a different way.
 */
async function applyProposal(
	row: ProposalRow,
	fields: Record<string, unknown>,
	executor: DbExecutor
): Promise<string> {
	switch (row.targetType) {
		case 'work_unit': {
			const approvalId = await approvalForDocument(row, executor);
			const created = await createApprovedWorkUnit(
				workUnitInputFromFields(row, fields),
				approvalId,
				{ kind: 'agent', proposalReference: row.id },
				`accepted from proposal ${row.id}`,
				executor
			);
			return created.id;
		}
	}
}

export type AcceptProposalInput = {
	/** Overrides onto the proposed fields — present only for the fields the
	 * reviewer actually changed. Merged onto `proposedFields` to produce
	 * `acceptedFields`; an empty or omitted object means the proposal was
	 * accepted exactly as proposed. */
	edits?: Record<string, unknown>;
	/** The reviewer's own email — who accepted, distinct from
	 * `resultId`'s row itself recording `{kind: 'agent', proposalReference}`
	 * as the provenance of its *values*. */
	decidedBy: string;
};

/**
 * Accepts a pending proposal: merges `edits` onto `proposedFields`, writes
 * the target row through `applyProposal`, and records the decision, all in
 * one transaction. If the target write is rejected by a database
 * constraint — the same constraint a human's own entry would trip — the
 * whole transaction rolls back and the proposal is left exactly as it was,
 * still `pending`: an accept attempt that fails produces neither a ledger
 * row nor a false `accepted` record.
 *
 * `proposedFields` merged with `edits` is checked against
 * `proposalValidationError` before `applyProposal` ever runs (#245): a
 * field the target table would reject is refused here, by name, instead
 * of surfacing as a raw constraint violation after `approvalForDocument`
 * or `createWorkUnit` already started writing. Checked against
 * `acceptedFields`, not the `validationError` stored on the row at
 * creation — an edit that fixes the offending field must be allowed
 * through.
 */
export async function acceptProposal(
	id: string,
	input: AcceptProposalInput,
	tx?: DbExecutor
): Promise<ProposalRow> {
	const run = async (executor: DbExecutor): Promise<ProposalRow> => {
		const row = await getProposal(id, executor);
		if (!row) throw new Error(`proposal ${id} not found`);
		if (row.status !== 'pending') {
			throw new Error(`proposal ${id} has already been decided (${row.status})`);
		}

		const acceptedFields = { ...row.proposedFields, ...(input.edits ?? {}) };
		// Re-checked against what is about to be written, not the
		// `validationError` stored at creation (#245): an edit on the review
		// screen that fixes the offending field must be allowed through, the
		// same way a proposal that was fine as proposed must stay refused if
		// an edit breaks it. Whichever it is, this runs before `applyProposal`
		// ever reaches `createWorkUnit`/`approvalForDocument`, so a rejected
		// accept here never touches either.
		const validationError = proposalValidationError(row.targetType, row.contractId, acceptedFields);
		if (validationError !== null) {
			throw new Error(`proposal ${id} cannot be accepted as proposed: ${validationError}`);
		}
		const resultId = await applyProposal(row, acceptedFields, executor);

		const [updated] = await executor
			.update(proposal)
			.set({
				status: 'accepted',
				acceptedFields,
				resultId,
				decidedBy: input.decidedBy,
				decidedAt: new Date()
			})
			.where(eq(proposal.id, id))
			.returning();
		return updated;
	};
	return tx ? run(tx) : db.transaction(run);
}

/** Rejects a pending proposal. Writes nothing to any other table — a
 * rejected proposal is only ever a decided row here, never a ledger entry
 * of any kind. */
export async function rejectProposal(
	id: string,
	decidedBy: string,
	tx?: DbExecutor
): Promise<ProposalRow> {
	const run = async (executor: DbExecutor): Promise<ProposalRow> => {
		const row = await getProposal(id, executor);
		if (!row) throw new Error(`proposal ${id} not found`);
		if (row.status !== 'pending') {
			throw new Error(`proposal ${id} has already been decided (${row.status})`);
		}
		const [updated] = await executor
			.update(proposal)
			.set({ status: 'rejected', decidedBy, decidedAt: new Date() })
			.where(eq(proposal.id, id))
			.returning();
		return updated;
	};
	return tx ? run(tx) : db.transaction(run);
}

export interface ProposalFieldChange {
	readonly field: string;
	readonly proposed: unknown;
	readonly accepted: unknown;
}

/**
 * Every field whose accepted value differs from what was proposed — #83's
 * acceptance criterion made concrete: "the diff between proposed and
 * accepted is the only honest measure of whether the agent is getting
 * better or worse." Computed on read from the two blobs `proposal` already
 * keeps forever, rather than stored as its own column, so it can never go
 * stale relative to them. Empty for a proposal accepted with no edits, and
 * always empty for one that is still pending or was rejected (no
 * `acceptedFields` to compare against).
 */
export function diffProposalFields(row: {
	proposedFields: Record<string, unknown>;
	acceptedFields: Record<string, unknown> | null;
}): ProposalFieldChange[] {
	if (!row.acceptedFields) return [];
	const accepted = row.acceptedFields;
	const fields = new Set([...Object.keys(row.proposedFields), ...Object.keys(accepted)]);
	const changes: ProposalFieldChange[] = [];
	for (const field of fields) {
		const proposedValue = row.proposedFields[field];
		const acceptedValue = accepted[field];
		if (JSON.stringify(proposedValue) !== JSON.stringify(acceptedValue)) {
			changes.push({ field, proposed: proposedValue, accepted: acceptedValue });
		}
	}
	return changes.sort((a, b) => a.field.localeCompare(b.field));
}
