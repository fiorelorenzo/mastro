-- #301: `document_validate_owner` (0010, widened 0011/0025/0026) proves
-- `owner_id` names a real row on every INSERT and UPDATE of `document`.
-- Nothing proved the same thing on DELETE of the *owner* itself: deleting
-- the invoice, expense or approval a document evidences used to succeed
-- outright, leaving the document pointing at a row that no longer
-- existed. That is invariant 4's mirror failure (AGENTS.md) — the
-- evidence survives, but nothing connects it to what it proved.
--
-- Delete paths checked before choosing an outcome
-- (`src/lib/server/repositories/*.ts`, grepped for `.delete(` and
-- `drop`): nothing in ordinary application use ever deletes an `invoice`,
-- `expense` or `approval` row. `deleteRenewalAssumption` and the
-- `client`/`clientContact` cleanup in `client.ts` are the only repository
-- deletes that exist, and neither table is a document owner. A soft,
-- nulling outcome — leaving the document as an unowned archive — was
-- considered and rejected for all three: there is no delete path today it
-- would need to accommodate, so refusal costs nothing in practice and
-- gives the same evidentiary guarantee `document_validate_owner` already
-- gives on write. `approval` doubly wants refusal: it is already
-- immutable against UPDATE (`drizzle/0011_approval_constraints.sql`), so
-- letting its DELETE silently orphan a document would be the one way
-- left to erase what it records.
--
-- `contract` needs no new trigger here. `document.contract_id` is a plain
-- foreign key (`ON DELETE restrict`, 0009_document_approval_work_unit.sql)
-- and is always set to the very same contract as `owner_id` whenever
-- `owner_type = 'contract'` (`createApproval`, `inbound-thread.ts`'s own
-- `ownerType: 'contract'` comment, `mail/poll.ts`): deleting a contract a
-- document points to already fails today, through that column.
--
-- `owner_type`'s allowed values are exactly the names of the tables they
-- point at (`document_owner_type_known`), so one function keyed by
-- `TG_TABLE_NAME` replaces the invoice/expense/approval branch
-- `document_validate_owner` would otherwise need three of, and needs no
-- widening at all when a later issue adds a fifth owner table whose name
-- also matches its `owner_type` value: one more `CREATE TRIGGER` below is
-- the whole change, the same "nothing rewritten" shape 0011/0025/0026
-- established for the INSERT/UPDATE side.
CREATE OR REPLACE FUNCTION document_forbid_owner_delete() RETURNS trigger AS $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM document WHERE owner_type = TG_TABLE_NAME AND owner_id = OLD.id
	) THEN
		RAISE EXCEPTION
			'% % is still the owner of at least one document; re-point or delete those documents first',
			TG_TABLE_NAME, OLD.id
			USING ERRCODE = 'foreign_key_violation',
			      CONSTRAINT = 'document_owner_blocks_' || TG_TABLE_NAME || '_delete';
	END IF;
	RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER invoice_forbid_owner_delete BEFORE DELETE ON "invoice"
	FOR EACH ROW EXECUTE FUNCTION document_forbid_owner_delete();

CREATE TRIGGER expense_forbid_owner_delete BEFORE DELETE ON "expense"
	FOR EACH ROW EXECUTE FUNCTION document_forbid_owner_delete();

CREATE TRIGGER approval_forbid_owner_delete BEFORE DELETE ON "approval"
	FOR EACH ROW EXECUTE FUNCTION document_forbid_owner_delete();
