import { relations } from 'drizzle-orm';
import { jsonb, numeric, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps } from '../columns';
import { contract } from './contract';
import { document } from './document';

export const proposalStatus = pgEnum('proposal_status', ['pending', 'accepted', 'rejected']);
export type ProposalStatus = (typeof proposalStatus.enumValues)[number];

/**
 * What kind of row an accepted proposal writes. A plain, CHECK-constrained
 * text column rather than a Postgres enum — the same reasoning as
 * `document.ownerType` (see that file's doc comment): widening the list is
 * a metadata-only migration, never an `ALTER TYPE ... ADD VALUE`. Only
 * `'work_unit'` exists today (#83's own proof, see `repositories/proposal.ts`);
 * `'contract'` and `'invoice'` are added by #86 and #87 respectively, each
 * once it ships the accept dispatcher that gives the value somewhere to go.
 */
export type ProposalTargetType = 'work_unit';

/**
 * The ACP runner's only output (epic #15, invariant 3): "an agent extracted
 * this from that text, at this confidence, and nothing has happened to the
 * ledger yet." `documentId` is the archived original (mail or PDF) the
 * extraction read; `excerpt` is the verbatim span the proposed fields rest
 * on, shown next to them during review the same way `approval.excerpt` is
 * shown next to the days it covers. `proposedFields` is a JSON object whose
 * shape depends on `targetType` — what a producer has to supply for each
 * target type is documented on the accept dispatcher in
 * `repositories/proposal.ts`, not enforced by a schema shared across every
 * possible target, because the real enforcement is accepting a proposal
 * writing through the same repository and the same database triggers a
 * human entry would (invariant 3's "no bypass").
 *
 * `contractId` scopes every proposal to the contract it concerns, the same
 * way `document.contractId` always does. It is `NOT NULL` because every
 * target type this table currently supports (`work_unit`) already has one;
 * a producer proposing a brand new contract (#86) has no contract row yet
 * to point at, and that issue has to either loosen this column or give a
 * contract-creation proposal a different shape — seeing #81's decision
 * comment on #86 for why this is called out rather than silently handled.
 *
 * `confidence` is the producer's own declared confidence, 0 (no confidence)
 * to 1 (certain), never computed after the fact. `confidenceReason` is the
 * producer's own short explanation for a lowered confidence — the model's,
 * for day extraction (#244: "the year is not written and nothing anchors
 * it", "the message reads as non-committal"), or the year-rollover guard's
 * own reason when that code-level check is the one that lowered it
 * (`YEAR_ROLLOVER_CONFIDENCE_CAP` in `agent/day-extraction.ts`). Null means
 * there was nothing to explain, not that the field went unset.
 *
 * `validationError` is set once, at creation, by `createProposal` itself
 * (#245): the first field `proposedFields` carries that the target table's
 * own constraints would reject, found out here rather than by a failed
 * `applyProposal` INSERT after a human already clicked Accept — the
 * contract-PDF spike's `paymentTerms: {day: 0}` is exactly this failure.
 * Null means every field the target's own dispatcher reads is one the
 * table would actually accept; non-null names what would fail and why, so
 * the review screen can show "needs correction" instead of an Accept
 * button that fails.
 *
 * `acceptedFields`, `resultId`, `decidedBy` and `decidedAt` are all null
 * until the proposal is decided, and populated together, exactly once, by
 * `acceptProposal`/`rejectProposal` — never edited afterwards. Storing both
 * `proposedFields` and `acceptedFields` (rather than a computed "diff"
 * column) is deliberate: the diff between the two is the whole point
 * (#83's acceptance — "the only honest measure of whether the agent is
 * getting better or worse"), and it stays correct forever only if neither
 * side is ever overwritten. `diffProposalFields` in `repositories/proposal.ts`
 * computes it on read.
 */
export const proposal = pgTable('proposal', {
	id: id(),
	documentId: uuid('document_id')
		.notNull()
		.references(() => document.id, { onDelete: 'restrict' }),
	contractId: uuid('contract_id')
		.notNull()
		.references(() => contract.id, { onDelete: 'restrict' }),
	targetType: text('target_type').notNull().$type<ProposalTargetType>(),
	proposedFields: jsonb('proposed_fields').$type<Record<string, unknown>>().notNull(),
	excerpt: text('excerpt').notNull(),
	confidence: numeric('confidence', { precision: 3, scale: 2, mode: 'number' }).notNull(),
	confidenceReason: text('confidence_reason'),
	validationError: text('validation_error'),
	status: proposalStatus('status').notNull().default('pending'),
	acceptedFields: jsonb('accepted_fields').$type<Record<string, unknown>>(),
	// The id of the row the accepted proposal produced. Not a foreign key:
	// like `document.ownerId`, it points at whichever table `targetType`
	// names, and Postgres has no FK that targets one of several tables. It
	// is not user-supplied either way, unlike `document.ownerId` — it is
	// only ever set by `acceptProposal` itself, in the same transaction as
	// the insert it points at, so it is correct by construction and needs
	// no validating trigger the way a polymorphic reference from outside
	// input would.
	resultId: uuid('result_id'),
	decidedBy: text('decided_by'),
	decidedAt: timestamp('decided_at', { withTimezone: true }),
	...timestamps()
});

export const proposalRelations = relations(proposal, ({ one }) => ({
	document: one(document, { fields: [proposal.documentId], references: [document.id] }),
	contract: one(contract, { fields: [proposal.contractId], references: [contract.id] })
}));
