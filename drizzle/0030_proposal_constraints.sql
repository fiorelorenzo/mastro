-- #83: the `updated_at` trigger every table installs, the CHECK constraints
-- Drizzle cannot express, and the trigger that carries invariant 3's "no
-- bypass" the other direction — not what accepting writes (that is
-- `repositories/proposal.ts` going through the target's own repository and
-- its own triggers), but what a decision, once made, can never become.

CREATE TRIGGER proposal_set_updated_at BEFORE UPDATE ON "proposal"
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE "proposal" ADD CONSTRAINT "proposal_excerpt_not_blank"
	CHECK (length(btrim(excerpt)) > 0);

ALTER TABLE "proposal" ADD CONSTRAINT "proposal_confidence_range"
	CHECK (confidence >= 0 AND confidence <= 1);

-- Only 'work_unit' exists at this point — #83's own accept dispatcher. #86
-- and #87 each widen this list (DROP/ADD, never `ALTER TYPE ... ADD VALUE`,
-- the same incremental pattern `document.owner_type` established) once
-- their own dispatcher gives 'contract' and 'invoice' somewhere to go.
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_target_type_known"
	CHECK (target_type IN ('work_unit'));

-- The three legal shapes of a proposal row: undecided and carrying nothing
-- about a decision yet, accepted and carrying everything a decision
-- produces, or rejected and carrying who/when but no accepted fields and
-- no result — never a partial mix of the two.
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_decision_shape"
	CHECK (
		(
			status = 'pending'
			AND decided_by IS NULL AND decided_at IS NULL
			AND accepted_fields IS NULL AND result_id IS NULL
		)
		OR (
			status = 'accepted'
			AND decided_by IS NOT NULL AND decided_at IS NOT NULL
			AND accepted_fields IS NOT NULL AND result_id IS NOT NULL
		)
		OR (
			status = 'rejected'
			AND decided_by IS NOT NULL AND decided_at IS NOT NULL
			AND accepted_fields IS NULL AND result_id IS NULL
		)
	);

-- What a producer supplies (document_id, contract_id, target_type,
-- proposed_fields, excerpt, confidence) is fixed at creation, the same way
-- `approval`'s columns are fixed once written: a correction is a new
-- proposal, never an edit of an existing one. What review adds (status,
-- accepted_fields, result_id, decided_by, decided_at) may move exactly
-- once, from pending to a terminal state — never back, and never twice.
-- Re-deciding an already-decided proposal is rejected here, not left to the
-- application layer to remember to check.
CREATE OR REPLACE FUNCTION proposal_forbid_retrofit() RETURNS trigger AS $$
BEGIN
	IF NEW.document_id IS DISTINCT FROM OLD.document_id
		OR NEW.contract_id IS DISTINCT FROM OLD.contract_id
		OR NEW.target_type IS DISTINCT FROM OLD.target_type
		OR NEW.proposed_fields IS DISTINCT FROM OLD.proposed_fields
		OR NEW.excerpt IS DISTINCT FROM OLD.excerpt
		OR NEW.confidence IS DISTINCT FROM OLD.confidence
	THEN
		RAISE EXCEPTION
			'proposal % fields are immutable after creation; only status, accepted_fields, result_id, decided_by and decided_at may change, and only once',
			NEW.id;
	END IF;

	IF OLD.status <> 'pending' THEN
		RAISE EXCEPTION 'proposal % has already been decided (%); a decision is final', NEW.id, OLD.status;
	END IF;

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER proposal_forbid_retrofit BEFORE UPDATE ON "proposal"
	FOR EACH ROW EXECUTE FUNCTION proposal_forbid_retrofit();
