-- #26: `set_updated_at` triggers for the two new tables, plus "totals that
-- add up is a database-level property, not a UI one." The row-level CHECK
-- constraints Drizzle could express already landed in 0014_invoice.sql;
-- this migration is what it cannot express — the cross-row arithmetic
-- tying an invoice's stated totals to the sum of its own lines.

CREATE TRIGGER invoice_set_updated_at BEFORE UPDATE ON "invoice"
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER invoice_line_set_updated_at BEFORE UPDATE ON "invoice_line"
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Checks, for whichever invoice a triggering row names, that:
--   taxable_amount = sum(invoice_line.amount) across its lines
--   total = taxable_amount + tax_amount + stamp_duty + social_charge
--
-- Fired as a constraint trigger, deferred to the end of the transaction,
-- because a line-by-line write necessarily passes through intermediate
-- states that do not balance yet: `createInvoice`
-- (`repositories/invoice.ts`) inserts the invoice row with its final
-- totals first, then each line after, and the sum only equals the total
-- once every line exists. Checking immediately, on each row event, would
-- reject that legitimate sequence; checking at commit does not.
--
-- Attached to both tables so either side of an edit is caught: editing
-- `invoice.total` alone (no line change) and editing a line alone (no
-- invoice change) both fire this the same way.
CREATE OR REPLACE FUNCTION invoice_check_totals() RETURNS trigger AS $$
DECLARE
	target_invoice_id uuid;
	inv record;
	computed_taxable integer;
BEGIN
	IF TG_TABLE_NAME = 'invoice_line' THEN
		target_invoice_id := COALESCE(NEW.invoice_id, OLD.invoice_id);
	ELSE
		target_invoice_id := NEW.id;
	END IF;

	SELECT * INTO inv FROM invoice WHERE id = target_invoice_id;
	-- The invoice itself was deleted later in the same transaction (cascade
	-- took the lines with it): nothing left to reconcile.
	IF NOT FOUND THEN
		RETURN NULL;
	END IF;

	SELECT COALESCE(SUM(amount), 0) INTO computed_taxable
	FROM invoice_line WHERE invoice_id = target_invoice_id;

	IF inv.taxable_amount <> computed_taxable THEN
		RAISE EXCEPTION
			'invoice % taxable_amount % does not match the sum of its lines (%)',
			target_invoice_id, inv.taxable_amount, computed_taxable;
	END IF;

	IF inv.total <> inv.taxable_amount + inv.tax_amount
		+ COALESCE(inv.stamp_duty, 0) + COALESCE(inv.social_charge, 0)
	THEN
		RAISE EXCEPTION
			'invoice % total % does not equal taxable_amount + tax_amount + stamp_duty + social_charge',
			target_invoice_id, inv.total;
	END IF;

	RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER invoice_check_totals
	AFTER INSERT OR UPDATE ON "invoice"
	DEFERRABLE INITIALLY DEFERRED
	FOR EACH ROW EXECUTE FUNCTION invoice_check_totals();

CREATE CONSTRAINT TRIGGER invoice_line_check_totals
	AFTER INSERT OR UPDATE OR DELETE ON "invoice_line"
	DEFERRABLE INITIALLY DEFERRED
	FOR EACH ROW EXECUTE FUNCTION invoice_check_totals();
