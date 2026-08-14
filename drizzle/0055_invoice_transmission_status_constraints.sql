-- #261: the hand-off transmission status enforced in the database, the
-- same way `work_unit_enforce_state_machine`
-- (0012_work_unit_state_machine.sql) enforces the day lifecycle — never
-- an application-layer check a future write path could skip.
--
-- Every invoice is inserted `generated` (the column default;
-- `createInvoice` never sets this explicitly), so only the UPDATE edges
-- need a graph: `generated -> transmitted` (marked sent by hand),
-- `transmitted -> accepted`/`rejected` (SdI's own receipt), and
-- `rejected -> transmitted` (a corrected resubmission, same number and
-- date per AdE's own guidance — never straight back to `accepted`, since
-- SdI still has to issue a fresh receipt against it). `accepted` is
-- terminal: nothing in `docs/specs/2026-08-14-electronic-invoicing.md`'s
-- own reading of AdE's guidance describes SdI reversing a delivered
-- receipt.
CREATE OR REPLACE FUNCTION invoice_enforce_transmission_status() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'INSERT' THEN
		IF NEW.transmission_status <> 'generated' THEN
			RAISE EXCEPTION 'invoice must be inserted with transmission_status generated, got %',
				NEW.transmission_status
				USING ERRCODE = 'check_violation';
		END IF;
	ELSIF NEW.transmission_status IS DISTINCT FROM OLD.transmission_status THEN
		IF NOT EXISTS (
			SELECT 1 FROM (VALUES
				('generated', 'transmitted'),
				('transmitted', 'accepted'),
				('transmitted', 'rejected'),
				('rejected', 'transmitted')
			) AS allowed_edge(from_status, to_status)
			WHERE allowed_edge.from_status = OLD.transmission_status::text
				AND allowed_edge.to_status = NEW.transmission_status::text
		) THEN
			RAISE EXCEPTION 'illegal invoice transmission_status transition: % -> %',
				OLD.transmission_status, NEW.transmission_status
				USING ERRCODE = 'check_violation';
		END IF;
	END IF;

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER invoice_enforce_transmission_status BEFORE INSERT OR UPDATE ON "invoice"
	FOR EACH ROW EXECUTE FUNCTION invoice_enforce_transmission_status();
