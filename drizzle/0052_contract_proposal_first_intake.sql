-- #86: the schema half of "propose a contract from a PDF". A contract's
-- own founding document has no contract row yet to be scoped by or owned
-- by — that row is what accepting the proposal creates — so both
-- `document` and `proposal` gain a genuinely unclaimed/first-intake shape
-- here, in the same incremental style every earlier widening in this
-- migration history uses (DROP/ADD a CHECK, CREATE OR REPLACE a trigger
-- function, never rewrite existing rows).

ALTER TABLE "document" ALTER COLUMN "contract_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "document" ALTER COLUMN "owner_type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "document" ALTER COLUMN "owner_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "proposal" ALTER COLUMN "contract_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_unclaimed_together" CHECK (("document"."contract_id" is null and "document"."owner_type" is null and "document"."owner_id" is null)
				or ("document"."contract_id" is not null and "document"."owner_type" is not null and "document"."owner_id" is not null));--> statement-breakpoint
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_contract_id_required_unless_first_intake_contract" CHECK ("proposal"."target_type" = 'contract' or "proposal"."contract_id" is not null);

-- 'contract' (#86) and 'invoice' (#87) land together: #87's own accept
-- dispatcher needs the same widened CHECK #86 needed for `contract_id` to
-- become nullable, so both are added in this one migration rather than
-- two separate widenings for what is really one change to this list.
ALTER TABLE "proposal" DROP CONSTRAINT "proposal_target_type_known";--> statement-breakpoint
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_target_type_known"
	CHECK (target_type IN ('work_unit', 'contract', 'invoice'));--> statement-breakpoint

-- `document_validate_owner()` (0010, widened 0011/0025/0026): unchanged
-- for every `owner_type` it already knows, plus one new case — a null
-- `owner_type` is the unclaimed state `document_unclaimed_together` above
-- allows, and there is nothing to check an owner against yet, so this
-- passes it through rather than raising. The CHECK above already proves
-- `owner_id` is null exactly when `owner_type` is, so this needs no
-- second look at `owner_id`.
CREATE OR REPLACE FUNCTION document_validate_owner() RETURNS trigger AS $$
BEGIN
	IF NEW.owner_type IS NULL THEN
		RETURN NEW;
	ELSIF NEW.owner_type = 'contract' THEN
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
	ELSIF NEW.owner_type = 'invoice' THEN
		IF NOT EXISTS (SELECT 1 FROM invoice WHERE id = NEW.owner_id) THEN
			RAISE EXCEPTION 'document owner_id % does not reference an existing invoice', NEW.owner_id;
		END IF;
	ELSE
		RAISE EXCEPTION 'document owner_type % is not recognised', NEW.owner_type;
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

-- `document_forbid_retrofit()` (0010): every column it already froze
-- stays frozen. `contract_id` gains exactly one legal transition — null
-- to a real contract, the "claim" `applyProposal`'s 'contract' case
-- performs in the same transaction that creates the contract a first-
-- intake proposal's accept produces. Once `contract_id` is set, this is
-- unchanged: re-pointing an already-claimed document to a different
-- contract is still forbidden, the same as before this migration.
CREATE OR REPLACE FUNCTION document_forbid_retrofit() RETURNS trigger AS $$
BEGIN
	IF NEW.hash IS DISTINCT FROM OLD.hash
		OR NEW.mime IS DISTINCT FROM OLD.mime
		OR NEW.size IS DISTINCT FROM OLD.size
		OR NEW.original_name IS DISTINCT FROM OLD.original_name
		OR NEW.provenance IS DISTINCT FROM OLD.provenance
		OR (OLD.contract_id IS NOT NULL AND NEW.contract_id IS DISTINCT FROM OLD.contract_id)
		OR NEW.confidential IS DISTINCT FROM OLD.confidential
	THEN
		RAISE EXCEPTION
			'document % fields are immutable after ingestion; only owner_type, owner_id, remote_file_id and a null contract_id (claimed exactly once) may change',
			NEW.id;
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;