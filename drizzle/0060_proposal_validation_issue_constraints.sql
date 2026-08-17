-- 0059 dropped `validation_error` and added `validation_issue`. Postgres
-- drops a CHECK constraint automatically when the column it solely
-- references is dropped, so `proposal_validation_error_not_blank`
-- (0041_proposal_confidence_and_validation_constraints.sql) is already
-- gone — there is no "not blank" equivalent for `validation_issue` to
-- carry forward anyway, since `validationIssue()` in
-- `$lib/proposals/validation-issue.ts` never constructs anything an empty
-- or blank check would catch.
--
-- 0041's immutability trigger is not so lucky: `proposal_forbid_retrofit`
-- still names `validation_error` in its own body. A trigger function's
-- `NEW`/`OLD` field references are late-bound to whatever the trigger
-- fires on, so 0059 did not break `CREATE FUNCTION` — it would have broken
-- the first `UPDATE` on `proposal` to actually run after this deploys,
-- with "record has no field validation_error". Replaced here, otherwise
-- identical to 0041's own definition.
CREATE OR REPLACE FUNCTION proposal_forbid_retrofit() RETURNS trigger AS $$
BEGIN
	IF NEW.document_id IS DISTINCT FROM OLD.document_id
		OR NEW.contract_id IS DISTINCT FROM OLD.contract_id
		OR NEW.target_type IS DISTINCT FROM OLD.target_type
		OR NEW.proposed_fields IS DISTINCT FROM OLD.proposed_fields
		OR NEW.excerpt IS DISTINCT FROM OLD.excerpt
		OR NEW.confidence IS DISTINCT FROM OLD.confidence
		OR NEW.confidence_reason IS DISTINCT FROM OLD.confidence_reason
		OR NEW.validation_issue IS DISTINCT FROM OLD.validation_issue
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
