-- The `updated_at` trigger every table installs, the CHECK constraints the
-- Drizzle schema cannot express, and the two triggers that carry #49's
-- invariants: a document's owner must actually exist, and everything about
-- a document except its owner and its mirror id is fixed at ingestion.

CREATE TRIGGER document_set_updated_at BEFORE UPDATE ON "document"
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE "document" ADD CONSTRAINT "document_hash_is_sha256_hex"
	CHECK (hash ~ '^[0-9a-f]{64}$');

ALTER TABLE "document" ADD CONSTRAINT "document_size_positive"
	CHECK (size > 0);

ALTER TABLE "document" ADD CONSTRAINT "document_original_name_not_blank"
	CHECK (length(btrim(original_name)) > 0);

-- Only 'contract' exists as an owner at this point in the migration
-- sequence; #22's migration widens this list to add 'approval' once the
-- `approval` table exists to be validated against. Widening it later is
-- exactly this: a DROP/ADD of the constraint, touching no existing row,
-- never an `ALTER TYPE ... ADD VALUE` and its same-transaction pitfalls.
ALTER TABLE "document" ADD CONSTRAINT "document_owner_type_known"
	CHECK (owner_type IN ('contract'));

-- `owner_id` cannot be a normal foreign key: it points at whichever table
-- `owner_type` names, and Postgres has no foreign key that targets one of
-- several tables. This trigger is the substitute, re-checked on every
-- insert or update and widened (via CREATE OR REPLACE, in #22's migration)
-- the same way the CHECK above is: one new branch per owner type that
-- comes to exist, nothing rewritten.
CREATE OR REPLACE FUNCTION document_validate_owner() RETURNS trigger AS $$
BEGIN
	IF NEW.owner_type = 'contract' THEN
		IF NOT EXISTS (SELECT 1 FROM contract WHERE id = NEW.owner_id) THEN
			RAISE EXCEPTION 'document owner_id % does not reference an existing contract', NEW.owner_id;
		END IF;
	ELSE
		RAISE EXCEPTION 'document owner_type % is not recognised', NEW.owner_type;
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER document_validate_owner BEFORE INSERT OR UPDATE ON "document"
	FOR EACH ROW EXECUTE FUNCTION document_validate_owner();

-- Invariant 4 and #49's acceptance ("confidential ... not retrofitted
-- later") in one place: once a document row is written, everything about
-- it is fixed except which entity it is currently attached to
-- (`owner_type`/`owner_id`, re-pointed once — see `createApproval` — when
-- the entity it evidences is confirmed after the fact) and whether it has
-- been mirrored (`remote_file_id`, #50, out of scope here). An application
-- check on this is one refactor from being bypassed; this is not.
CREATE OR REPLACE FUNCTION document_forbid_retrofit() RETURNS trigger AS $$
BEGIN
	IF NEW.hash IS DISTINCT FROM OLD.hash
		OR NEW.mime IS DISTINCT FROM OLD.mime
		OR NEW.size IS DISTINCT FROM OLD.size
		OR NEW.original_name IS DISTINCT FROM OLD.original_name
		OR NEW.provenance IS DISTINCT FROM OLD.provenance
		OR NEW.contract_id IS DISTINCT FROM OLD.contract_id
		OR NEW.confidential IS DISTINCT FROM OLD.confidential
	THEN
		RAISE EXCEPTION
			'document % fields are immutable after ingestion; only owner_type, owner_id and remote_file_id may change',
			NEW.id;
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER document_forbid_retrofit BEFORE UPDATE ON "document"
	FOR EACH ROW EXECUTE FUNCTION document_forbid_retrofit();
