-- #20 and #28: `set_updated_at` triggers for the two new tables, the CHECK
-- constraints Drizzle cannot express, the widening of #49's document owner
-- validation now that `expense` exists as a fourth kind of receipt owner,
-- and the two triggers that carry #28's actual point — a non-reimbursable
-- expense is flagged, not rejected, and a rebilled expense cannot be
-- rebilled onto a second invoice line.

CREATE TRIGGER clause_note_set_updated_at BEFORE UPDATE ON "clause_note"
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER expense_set_updated_at BEFORE UPDATE ON "expense"
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE "clause_note" ADD CONSTRAINT "clause_note_clause_reference_not_blank"
	CHECK (length(btrim(clause_reference)) > 0);

ALTER TABLE "clause_note" ADD CONSTRAINT "clause_note_verbatim_text_not_blank"
	CHECK (length(btrim(verbatim_text)) > 0);

ALTER TABLE "clause_note" ADD CONSTRAINT "clause_note_interpretation_adopted_not_blank"
	CHECK (length(btrim(interpretation_adopted)) > 0);

ALTER TABLE "expense" ADD CONSTRAINT "expense_amount_positive"
	CHECK (amount > 0);

ALTER TABLE "expense" ADD CONSTRAINT "expense_description_not_blank"
	CHECK (length(btrim(description)) > 0);

-- `authorisation_reference` is the written proof the pre-authorisation
-- happened: required exactly when `pre_authorised` is true, meaningless
-- (and forbidden, so a stale reference can never survive unchecking the
-- box) otherwise — the same required-for-one-forbidden-for-the-other shape
-- `contract_renewal_notice_days_required` already uses. Both branches spell
-- out `IS NOT NULL`/`IS NULL` explicitly rather than leaning on `btrim(...)
-- > 0` alone: a bare comparison against a NULL `authorisation_reference`
-- evaluates to NULL, and Postgres treats a NULL CHECK result as satisfied,
-- which would silently accept `pre_authorised = true` with no reference.
ALTER TABLE "expense" ADD CONSTRAINT "expense_authorisation_reference_matches_pre_authorised"
	CHECK (
		(pre_authorised AND authorisation_reference IS NOT NULL AND length(btrim(authorisation_reference)) > 0)
		OR (NOT pre_authorised AND authorisation_reference IS NULL)
	);

-- Widen #49's document owner validation now that `expense` exists: a
-- document can now also be owned by an expense (its receipt). Metadata-only,
-- touching no existing `document` row, same as #22's widening for 'approval'.
ALTER TABLE "document" DROP CONSTRAINT "document_owner_type_known";
ALTER TABLE "document" ADD CONSTRAINT "document_owner_type_known"
	CHECK (owner_type IN ('contract', 'approval', 'expense'));

CREATE OR REPLACE FUNCTION document_validate_owner() RETURNS trigger AS $$
BEGIN
	IF NEW.owner_type = 'contract' THEN
		IF NOT EXISTS (SELECT 1 FROM contract WHERE id = NEW.owner_id) THEN
			RAISE EXCEPTION 'document owner_id % does not reference an existing contract', NEW.owner_id;
		END IF;
	ELSIF NEW.owner_type = 'approval' THEN
		IF NOT EXISTS (SELECT 1 FROM approval WHERE id = NEW.owner_id) THEN
			RAISE EXCEPTION 'document owner_id % does not reference an existing approval', NEW.owner_id;
		END IF;
	ELSIF NEW.owner_type = 'expense' THEN
		IF NOT EXISTS (SELECT 1 FROM expense WHERE id = NEW.owner_id) THEN
			RAISE EXCEPTION 'document owner_id % does not reference an existing expense', NEW.owner_id;
		END IF;
	ELSE
		RAISE EXCEPTION 'document owner_type % is not recognised', NEW.owner_type;
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- #28's first acceptance bullet, enforced in the database rather than in a
-- form handler: an expense without pre-authorisation, on a contract that
-- requires one for reimbursement, is flagged non-reimbursable rather than
-- rejected — the same "still recorded, never hidden" treatment
-- `work_unit_enforce_state_machine` gives a day worked without approval.
-- `reimbursable` is recomputed on every insert or update, from whatever
-- the row and its contract say right now; the application never sets it
-- directly.
CREATE OR REPLACE FUNCTION expense_set_reimbursable() RETURNS trigger AS $$
DECLARE
	requires_preauth boolean;
	policy_kind text;
BEGIN
	SELECT c.requires_expense_pre_authorisation, c.expense_policy ->> 'kind'
	INTO requires_preauth, policy_kind
	FROM contract c WHERE c.id = NEW.contract_id;

	NEW.reimbursable := (policy_kind <> 'not_reimbursed')
		AND (NOT requires_preauth OR NEW.pre_authorised);

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER expense_set_reimbursable BEFORE INSERT OR UPDATE ON "expense"
	FOR EACH ROW EXECUTE FUNCTION expense_set_reimbursable();

-- #28's second acceptance bullet: a rebilled expense cannot be rebilled
-- twice. `invoice_line_id` may move from NULL to a line (the rebilling
-- itself); once set, it is fixed — a constraint, not a convention a form
-- handler could forget to enforce.
CREATE OR REPLACE FUNCTION expense_forbid_rebill_twice() RETURNS trigger AS $$
BEGIN
	IF OLD.invoice_line_id IS NOT NULL AND NEW.invoice_line_id IS DISTINCT FROM OLD.invoice_line_id THEN
		RAISE EXCEPTION 'expense % is already rebilled onto invoice_line %; it cannot be rebilled again',
			OLD.id, OLD.invoice_line_id;
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER expense_forbid_rebill_twice BEFORE UPDATE ON "expense"
	FOR EACH ROW EXECUTE FUNCTION expense_forbid_rebill_twice();
