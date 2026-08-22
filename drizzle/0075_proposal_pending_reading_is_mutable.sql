-- Task 5 (#403 revised): a re-read of a conversation now rewrites a
-- pending proposal in place instead of being suppressed by it, and that
-- write is exactly what `proposal_forbid_retrofit`
-- (0060_proposal_validation_issue_constraints.sql, itself a restatement of
-- 0030's original) refuses: it forbids any UPDATE that changes
-- `document_id`, `contract_id`, `target_type`, `proposed_fields`,
-- `excerpt`, `confidence`, `confidence_reason` or `validation_issue`,
-- whatever the row's status. Without this migration `reviseDayProposal`
-- (`src/lib/server/repositories/proposal.ts`) raises at runtime, not at
-- build time.
--
-- The relaxation is narrow, and it draws the line the product already
-- holds: a decision is final, a reading is not. That splits the eight
-- columns above into two groups instead of loosening them all:
--
--   * Identity — what the proposal is about — stays immutable always:
--     `contract_id`, `target_type`. A proposal can never be retargeted at
--     another contract, or turned from a day into a contract, at any
--     status. (`reviseDayProposal`'s own input carries neither column, so
--     nothing above the trigger needed to change for this half either.)
--
--   * Evidence — the current reading and the message it rests on — is
--     mutable, but only while `status = 'pending'`: `document_id`,
--     `proposed_fields`, `excerpt`, `confidence`, `confidence_reason`,
--     `validation_issue`.
--
-- `document_id` belongs with the evidence, not the identity, and that is
-- the one part of this migration worth spelling out: an earlier draft of
-- this comment put it with `contract_id` and forbade it from ever moving.
-- That was wrong, not merely stricter than needed. Invariant 4
-- ("`applyProposal` never keeps only the extracted fields — every derived
-- datum keeps its source document, because if a client disputes a day,
-- what counts is the original message, not the row") is a statement
-- about `excerpt` and `document_id` agreeing, not about `document_id`
-- alone. A re-read of a multi-message thread can re-attribute a day's
-- evidence to a different message than the one it first read (see
-- `writeDayProposals` in `src/lib/server/agent/day-producer.ts`, which
-- resolves each day's `documentId` from its own `messageIndex`); if the
-- new excerpt were allowed to move while the old `document_id` stayed
-- pinned, the row would name a document that does not contain the
-- excerpt sitting next to it — precisely the failure invariant 4 exists
-- to prevent. So `document_id` and `excerpt` move together, or not at
-- all, and forbidding one while allowing the other would have been a
-- subtler defect than the exception this migration replaces: a
-- silently-wrong row instead of a loud crash. When a re-read does move a
-- proposal to a different document this way, the review queue
-- (`src/routes/proposals/+page.server.ts`) groups pending rows by
-- `documentId`, so the row moves to a different card — that is the
-- correct, intended effect of a corrected reading, not a bug, and it is
-- exactly what Task 4's "Revised" badge (`proposalRevised` in
-- `src/routes/proposals/queue-fields.ts`) is there to flag.
--
-- No structural constraint depends on the old, wider immutability:
-- `proposal` has no unique index involving `document_id` (only
-- `proposal_pkey`, `proposal_status_idx` and a plain, non-unique
-- `proposal_document_id_idx`), and `proposal.document_id`'s foreign key
-- is `ON DELETE restrict`, so re-pointing a pending row at another
-- document already referenced by the same contract violates nothing and
-- orphans nothing.
--
-- The second rule is untouched: once `OLD.status` is anything but
-- `pending`, every UPDATE is still refused, whatever column it touches.
-- An accepted or rejected proposal — evidence included — stays frozen
-- with the words it was decided on.
CREATE OR REPLACE FUNCTION proposal_forbid_retrofit() RETURNS trigger AS $$
BEGIN
	IF NEW.contract_id IS DISTINCT FROM OLD.contract_id
		OR NEW.target_type IS DISTINCT FROM OLD.target_type
	THEN
		RAISE EXCEPTION
			'proposal % contract_id and target_type are immutable; document_id, proposed_fields, excerpt, confidence, confidence_reason and validation_issue may change only while status is still pending, and status/accepted_fields/result_id/decided_by/decided_at may be set only once, deciding that same pending row — nothing changes once a proposal is decided',
			NEW.id;
	END IF;

	IF OLD.status <> 'pending' THEN
		RAISE EXCEPTION 'proposal % has already been decided (%); a decision is final', NEW.id, OLD.status;
	END IF;

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
