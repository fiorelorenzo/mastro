-- #213: a credit note (or debit note) references the invoice it corrects
-- (`corrects_invoice_id`, added in 0042; the CHECK there already pins it to
-- `document_type in ('credit_note', 'debit_note')`). What a CHECK cannot
-- express — because it has to read a second row — lives here, as a
-- deferred constraint trigger paired with `invoice_check_totals`
-- (0015_invoice_constraints.sql):
--
--   1. the referenced row must itself be an ordinary invoice, never
--      another correction and never itself — chaining corrections would
--      make "how much has this invoice actually been reduced by" require
--      walking an arbitrary graph instead of one lookup.
--   2. a credit note may never claim more, summed across every credit
--      note that names the same original invoice, than that invoice's own
--      `total` — the database-level version of "you cannot credit back
--      more than you billed."
--
-- Deferred to commit, like `invoice_check_totals`, so `document_type`,
-- `corrects_invoice_id` and `total` can all be set on the same INSERT
-- (which `createInvoice` always does) without the check firing on an
-- incomplete intermediate state, and so several credit notes inserted in
-- one transaction are checked against each other's final totals, not just
-- their own.
CREATE OR REPLACE FUNCTION invoice_check_correction() RETURNS trigger AS $$
DECLARE
	original record;
	credited_total integer;
BEGIN
	IF NEW.corrects_invoice_id IS NULL THEN
		RETURN NULL;
	END IF;

	IF NEW.corrects_invoice_id = NEW.id THEN
		RAISE EXCEPTION 'invoice % cannot correct itself', NEW.id
			USING ERRCODE = 'check_violation',
			      CONSTRAINT = 'invoice_corrects_invoice_id_targets_ordinary_invoice';
	END IF;

	-- The FK on corrects_invoice_id guarantees a row exists by the time
	-- this deferred trigger runs; nothing in this schema ever deletes an
	-- invoice row (its own FK to contract is `restrict`), so it cannot
	-- have vanished mid-transaction either.
	SELECT document_type, total INTO original
	FROM invoice WHERE id = NEW.corrects_invoice_id;

	IF original.document_type IN ('credit_note', 'debit_note') THEN
		RAISE EXCEPTION
			'invoice % (%) must correct an ordinary invoice; % is itself a %',
			NEW.id, NEW.document_type, NEW.corrects_invoice_id, original.document_type
			USING ERRCODE = 'check_violation',
			      CONSTRAINT = 'invoice_corrects_invoice_id_targets_ordinary_invoice';
	END IF;

	IF NEW.document_type = 'credit_note' THEN
		SELECT COALESCE(SUM(total), 0) INTO credited_total
		FROM invoice
		WHERE corrects_invoice_id = NEW.corrects_invoice_id
			AND document_type = 'credit_note';

		IF credited_total > original.total THEN
			RAISE EXCEPTION
				'invoice % credits % (this note) toward invoice %''s own total of %; % would be credited against it in total',
				NEW.id, NEW.total, NEW.corrects_invoice_id, original.total, credited_total
				USING ERRCODE = 'check_violation',
				      CONSTRAINT = 'invoice_credit_note_not_exceeding_original';
		END IF;
	END IF;

	RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER invoice_check_correction
	AFTER INSERT OR UPDATE ON "invoice"
	DEFERRABLE INITIALLY DEFERRED
	FOR EACH ROW EXECUTE FUNCTION invoice_check_correction();
