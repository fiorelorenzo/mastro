-- #44: a folder import writes an `invoice` row, and the structured document
-- (plus any PDF attached alongside it — a re-issue, a scan of the signed
-- original) has to be owned by it. Widens `document`'s owner-type list the
-- same incremental way `0011_approval_constraints.sql` added `approval`:
-- DROP/ADD the CHECK (metadata-only, touches no existing row) and
-- CREATE OR REPLACE the validation trigger with one more branch.

ALTER TABLE "document" DROP CONSTRAINT "document_owner_type_known";
ALTER TABLE "document" ADD CONSTRAINT "document_owner_type_known"
	CHECK (owner_type IN ('contract', 'approval', 'invoice'));

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
	ELSIF NEW.owner_type = 'invoice' THEN
		IF NOT EXISTS (SELECT 1 FROM invoice WHERE id = NEW.owner_id) THEN
			RAISE EXCEPTION 'document owner_id % does not reference an existing invoice', NEW.owner_id;
		END IF;
	ELSE
		RAISE EXCEPTION 'document owner_type % is not recognised', NEW.owner_type;
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
