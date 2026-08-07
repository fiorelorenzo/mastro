-- #23: a day recorded `worked` on a contract that requires prior approval,
-- with no approval linked, must enter `worked_without_approval`
-- automatically — not rejected like `approved` without one (#21), and not
-- silently accepted as a clean `worked` day either. Widens
-- `work_unit_enforce_state_machine` (0012_work_unit_state_machine.sql) via
-- CREATE OR REPLACE, the same incremental pattern #49's
-- `document_validate_owner` uses for a new owner type.
CREATE OR REPLACE FUNCTION work_unit_enforce_state_machine() RETURNS trigger AS $$
DECLARE
	requires_approval boolean;
BEGIN
	SELECT c.requires_prior_approval INTO requires_approval
	FROM contract c WHERE c.id = NEW.contract_id;

	-- The redirect: a `worked` day on such a contract with no approval
	-- becomes the risk state instead, silently as far as the caller's
	-- write is concerned but never hidden afterward — it is its own state,
	-- visible to every query and logged by work_unit_log_transition like
	-- any other transition (see worked_without_approval.test.ts).
	IF NEW.state = 'worked' AND requires_approval AND NEW.approval_id IS NULL THEN
		NEW.state := 'worked_without_approval';
	END IF;

	-- The recovery: linking an approval to a day sitting in the risk state
	-- moves it to 'worked' on its own. This covers both a caller that only
	-- sets approval_id (linkApprovalToWorkUnit) and one that also asks for
	-- 'worked' explicitly; either way work_unit_log_transition still
	-- records the day passed through worked_without_approval on the way.
	IF NEW.state = 'worked_without_approval' AND NEW.approval_id IS NOT NULL THEN
		NEW.state := 'worked';
	END IF;

	IF TG_OP = 'INSERT' THEN
		IF NEW.state NOT IN ('proposed', 'worked', 'worked_without_approval') THEN
			RAISE EXCEPTION 'work_unit cannot be inserted directly into state %', NEW.state;
		END IF;
	ELSIF NEW.state IS DISTINCT FROM OLD.state THEN
		IF NOT EXISTS (
			SELECT 1 FROM (VALUES
				('proposed', 'approved'),
				('proposed', 'rejected'),
				('approved', 'worked'),
				('approved', 'revoked'),
				('worked', 'invoiced'),
				('worked_without_approval', 'worked'),
				('worked_without_approval', 'unbillable'),
				('invoiced', 'paid'),
				('invoiced', 'disputed'),
				('disputed', 'invoiced')
			) AS allowed_edge(from_state, to_state)
			WHERE allowed_edge.from_state = OLD.state::text AND allowed_edge.to_state = NEW.state::text
		) THEN
			RAISE EXCEPTION 'illegal work_unit transition: % -> %', OLD.state, NEW.state;
		END IF;
	END IF;

	IF requires_approval
		AND NEW.state IN ('approved', 'worked', 'invoiced', 'paid', 'disputed', 'revoked')
		AND NEW.approval_id IS NULL
	THEN
		RAISE EXCEPTION
			'work_unit % on a contract that requires prior approval needs an approval_id',
			NEW.state;
	END IF;

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
