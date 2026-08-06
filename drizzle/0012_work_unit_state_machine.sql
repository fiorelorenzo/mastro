-- #21: the day lifecycle (epic #2) enforced in the database. `updated_at`
-- triggers, the CHECK constraints and partial unique index Drizzle cannot
-- express, the transition-legality trigger, and the append-only log.
--
-- The automatic entry into `worked_without_approval` and the automatic
-- recovery out of it (#23) are deliberately NOT in this migration: this
-- one is the base state machine, and #23 widens
-- `work_unit_enforce_state_machine` (via CREATE OR REPLACE, the same
-- incremental pattern used for `document_validate_owner`) in the next one.
-- Every acceptance bullet #21 itself asks for — the approval requirement,
-- illegal-transition rejection, and the log — holds without that part.

CREATE TRIGGER work_unit_set_updated_at BEFORE UPDATE ON "work_unit"
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Never actually runs, same as `approval_set_updated_at`: the append-only
-- trigger below rejects every UPDATE. Kept for the same reason.
CREATE TRIGGER work_unit_transition_set_updated_at BEFORE UPDATE ON "work_unit_transition"
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE "work_unit" ADD CONSTRAINT "work_unit_quantity_positive"
	CHECK (quantity > 0);

-- A day in the risk state by definition has no approval linking it; #23's
-- recovery path moves it to 'worked' the moment one is linked, it never
-- leaves a row sitting in this state with an approval_id set.
ALTER TABLE "work_unit" ADD CONSTRAINT "work_unit_worked_without_approval_has_no_approval"
	CHECK (state <> 'worked_without_approval' OR approval_id IS NULL);

-- "paid is derived from the invoice, never set on the day directly" (epic
-- #2): both invoiced and paid days must already be on an invoice line.
ALTER TABLE "work_unit" ADD CONSTRAINT "work_unit_invoiced_or_paid_has_invoice_line"
	CHECK (state NOT IN ('invoiced', 'paid') OR invoice_line_id IS NOT NULL);

-- At most one day per contract per date is ever "live" at a time.
-- 'rejected' and 'revoked' days are excluded, so a new proposal for the
-- same date after an earlier one was rejected or revoked is not blocked
-- by it — this is a partial unique index precisely because that exclusion
-- cannot be expressed any other way.
CREATE UNIQUE INDEX "work_unit_one_active_per_contract_date"
	ON "work_unit" (contract_id, date)
	WHERE state NOT IN ('rejected', 'revoked');

-- The state machine itself. `contract_id` cannot be looked up from a CHECK
-- constraint (no subqueries), so the approval requirement — "approved
-- requires an approval_id when the contract has requires_prior_approval",
-- epic #2 — has to live here. So does transition legality: no UPDATE can
-- move `state` along an edge this graph does not contain, and no INSERT
-- can start anywhere but 'proposed', 'worked' or 'worked_without_approval'.
CREATE OR REPLACE FUNCTION work_unit_enforce_state_machine() RETURNS trigger AS $$
DECLARE
	requires_approval boolean;
BEGIN
	SELECT c.requires_prior_approval INTO requires_approval
	FROM contract c WHERE c.id = NEW.contract_id;

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

CREATE TRIGGER work_unit_enforce_state_machine BEFORE INSERT OR UPDATE ON "work_unit"
	FOR EACH ROW EXECUTE FUNCTION work_unit_enforce_state_machine();

-- The append-only log. A row here is written by this trigger alone, never
-- by application code directly, so no write path can produce a state
-- change this table does not see. `actor`/`reason` travel as session-local
-- settings the repository layer sets immediately before the write
-- (`set_config(..., true)`, scoped to the current transaction) — the only
-- way for a value to reach a trigger body that is not a column on the row
-- being written. Unset (a write outside the repository, e.g. a future
-- import connecting directly) falls back to a system actor and a generic
-- reason rather than failing, so the log is never silently incomplete.
CREATE OR REPLACE FUNCTION work_unit_log_transition() RETURNS trigger AS $$
DECLARE
	actor_json jsonb;
	reason_text text;
BEGIN
	IF TG_OP = 'UPDATE' AND NEW.state = OLD.state THEN
		RETURN NEW;
	END IF;

	actor_json := coalesce(
		nullif(current_setting('mastro.actor', true), '')::jsonb,
		'{"kind":"system"}'::jsonb
	);
	reason_text := coalesce(nullif(current_setting('mastro.reason', true), ''), 'no reason supplied');

	INSERT INTO work_unit_transition (work_unit_id, from_state, to_state, actor, reason)
	VALUES (
		NEW.id,
		CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.state END,
		NEW.state,
		actor_json,
		reason_text
	);

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER work_unit_log_transition AFTER INSERT OR UPDATE ON "work_unit"
	FOR EACH ROW EXECUTE FUNCTION work_unit_log_transition();

-- Append-only, at the database level, the same way `approval` is immutable:
-- `raise_immutable_violation` already exists (0010_approval_constraints.sql).
CREATE TRIGGER work_unit_transition_immutable BEFORE UPDATE OR DELETE ON "work_unit_transition"
	FOR EACH ROW EXECUTE FUNCTION raise_immutable_violation();
