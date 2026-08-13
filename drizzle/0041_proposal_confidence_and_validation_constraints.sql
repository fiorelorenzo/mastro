-- #244/#245: two more producer-supplied columns, checked and folded into
-- the same immutability guarantee `excerpt`/`confidence` already have
-- (0030_proposal_constraints.sql). `confidence_reason` is the model's or
-- the year-rollover guard's own explanation for a lowered confidence
-- (#244); `validation_error` is what `createProposal` found wrong against
-- the target table's own constraints before a human ever saw the row
-- (#245). Both null means "nothing to say", which is a different thing
-- from a blank string — the same distinction `excerpt` already draws.

ALTER TABLE "proposal" ADD CONSTRAINT "proposal_confidence_reason_not_blank"
	CHECK (confidence_reason IS NULL OR length(btrim(confidence_reason)) > 0);

ALTER TABLE "proposal" ADD CONSTRAINT "proposal_validation_error_not_blank"
	CHECK (validation_error IS NULL OR length(btrim(validation_error)) > 0);

-- Widens 0030's immutability trigger: a producer's two new columns are
-- fixed at creation exactly like its other five, never editable by a
-- later UPDATE (review only ever moves status/accepted_fields/result_id/
-- decided_by/decided_at, and only once).
CREATE OR REPLACE FUNCTION proposal_forbid_retrofit() RETURNS trigger AS $$
BEGIN
	IF NEW.document_id IS DISTINCT FROM OLD.document_id
		OR NEW.contract_id IS DISTINCT FROM OLD.contract_id
		OR NEW.target_type IS DISTINCT FROM OLD.target_type
		OR NEW.proposed_fields IS DISTINCT FROM OLD.proposed_fields
		OR NEW.excerpt IS DISTINCT FROM OLD.excerpt
		OR NEW.confidence IS DISTINCT FROM OLD.confidence
		OR NEW.confidence_reason IS DISTINCT FROM OLD.confidence_reason
		OR NEW.validation_error IS DISTINCT FROM OLD.validation_error
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
