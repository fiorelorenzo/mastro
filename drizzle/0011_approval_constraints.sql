-- The `updated_at` trigger — installed for schema-convention consistency
-- even though it can never actually fire, see below — the CHECK
-- constraints the Drizzle schema cannot express, the immutability trigger
-- that is #22's whole point, and the widening of #49's document owner
-- validation now that `approval` exists to be one.

-- Never actually runs: `approval_immutable`, below, rejects every UPDATE
-- outright, so `updated_at` can never move past its initial value. Kept
-- anyway so this table looks like every other one at a glance, per
-- AGENTS.md's column conventions.
CREATE TRIGGER approval_set_updated_at BEFORE UPDATE ON "approval"
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE "approval" ADD CONSTRAINT "approval_sender_not_blank"
	CHECK (length(btrim(sender)) > 0);

ALTER TABLE "approval" ADD CONSTRAINT "approval_excerpt_not_blank"
	CHECK (length(btrim(excerpt)) > 0);

-- {kind:'manual'} or {kind:'agent', proposalReference}, mirroring how
-- contract's payment_terms/expense_policy shapes are validated.
ALTER TABLE "approval" ADD CONSTRAINT "approval_origin_shape"
	CHECK (
		(origin ->> 'kind') = 'manual'
		OR (
			(origin ->> 'kind') = 'agent'
			AND coalesce(length(origin ->> 'proposalReference'), 0) > 0
		)
	);

-- #22's acceptance: "An approval cannot be updated after creation; the
-- attempt fails." Deletion is left to the ordinary `restrict` foreign key
-- from `work_unit.approval_id`: once a day actually relies on an approval,
-- deleting it is already rejected the same way deleting a referenced
-- contract is. Blocking delete unconditionally, even for an approval
-- nothing has ever pointed at, was considered and left out: nothing in
-- #22 asks for it, and this table has no soft-delete/erasure story yet
-- (see `document.confidential`'s doc comment) to hang a deliberate
-- hard-delete escape hatch off. A correction is still always a new
-- approval, never an edit of an existing one.
CREATE OR REPLACE FUNCTION raise_immutable_violation() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION '% rows are immutable once written; % is not allowed', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER approval_immutable BEFORE UPDATE ON "approval"
	FOR EACH ROW EXECUTE FUNCTION raise_immutable_violation();

-- Widen #49's document owner validation now that `approval` exists: a
-- document can now also be owned by an approval (its archived original),
-- re-pointed there by `createApproval` once the approval row exists. This
-- is the whole reason `owner_type` is a CHECK, not a Postgres enum: this
-- is a metadata-only change, touching no existing `document` row.
ALTER TABLE "document" DROP CONSTRAINT "document_owner_type_known";
ALTER TABLE "document" ADD CONSTRAINT "document_owner_type_known"
	CHECK (owner_type IN ('contract', 'approval'));

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
	ELSE
		RAISE EXCEPTION 'document owner_type % is not recognised', NEW.owner_type;
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
