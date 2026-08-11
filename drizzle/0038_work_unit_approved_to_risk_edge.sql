-- #23's redirect could not fire for a day already `approved`.
--
-- The trigger rewrites `worked` to `worked_without_approval` when the
-- contract requires prior approval and no approval is linked, and it does
-- that BEFORE checking the edge is legal. So a day moving `approved ->
-- worked` was rewritten to `approved -> worked_without_approval`, which the
-- allowed-edge list did not contain, and the write was rejected outright
-- with `illegal work_unit transition`.
--
-- The effect was that the risk state only ever caught a day recorded
-- `worked` from scratch, never one already mid-flight — which is precisely
-- the case 0013's own comment says it exists for ("once the contract is
-- edited to require approval later, a day already mid-flight without one
-- still gets caught the moment it is recorded worked").
--
-- `worked_without_approval.test.ts` asserted the documented behaviour and
-- passed for a year regardless, because the rolled-back-transaction test
-- pattern swallowed the rejection (#191). Adding the edge is the whole fix;
-- the redirect above it is unchanged, and the state is still only reachable
-- when the approval is genuinely missing.
CREATE OR REPLACE FUNCTION work_unit_enforce_state_machine() RETURNS trigger AS $$
DECLARE
	requires_approval boolean;
BEGIN
	SELECT c.requires_prior_approval INTO requires_approval
	FROM contract c WHERE c.id = NEW.contract_id;

	IF NEW.state = 'worked' AND requires_approval AND NEW.approval_id IS NULL THEN
		NEW.state := 'worked_without_approval';
	END IF;

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
				-- The edge this migration adds: where the redirect above lands
				-- when a day that was approved is recorded worked with no
				-- approval on file.
				('approved', 'worked_without_approval'),
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
