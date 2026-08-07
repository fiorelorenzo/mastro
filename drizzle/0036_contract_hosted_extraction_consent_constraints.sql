-- #81/#82: `contract.hosted_extraction_consent_document_id` is never a bare
-- boolean. A value here is only legal when it points at a `document` row
-- actually archived as this contract's own consent evidence — owned by it
-- (`owner_type = 'contract'`, `owner_id = <this contract>`), the same
-- evidentiary shape invariant 4 requires everywhere else. Without this
-- trigger, an application bug (or a future writer who has not read this
-- comment) could point the column at any document at all — a signed
-- contract, someone else's receipt — and the column would silently stop
-- meaning "this client consented in writing".
--
-- `document_validate_owner()` (0010/0026) already proves `owner_id` names a
-- real contract when `owner_type = 'contract'`; this trigger is the other
-- half, proving the document this column names is that same evidentiary
-- link, not merely some document that happens to exist.
CREATE OR REPLACE FUNCTION contract_validate_hosted_extraction_consent() RETURNS trigger AS $$
BEGIN
	IF NEW.hosted_extraction_consent_document_id IS NOT NULL THEN
		IF NOT EXISTS (
			SELECT 1 FROM document
			WHERE id = NEW.hosted_extraction_consent_document_id
				AND owner_type = 'contract'
				AND owner_id = NEW.id
		) THEN
			RAISE EXCEPTION
				'contract % hosted_extraction_consent_document_id % must reference a document archived as this contract''s own evidence (owner_type = ''contract'', owner_id = %)',
				NEW.id, NEW.hosted_extraction_consent_document_id, NEW.id;
		END IF;
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER contract_validate_hosted_extraction_consent BEFORE INSERT OR UPDATE ON "contract"
	FOR EACH ROW EXECUTE FUNCTION contract_validate_hosted_extraction_consent();
