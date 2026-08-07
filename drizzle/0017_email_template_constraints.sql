-- #71/#72: the `updated_at` trigger every table installs, the CHECK
-- constraints Drizzle cannot express, and `sent_email`'s append-only
-- guarantee — a record of an irreversible outward action is not something
-- a later write should be able to quietly change.

CREATE TRIGGER email_template_set_updated_at BEFORE UPDATE ON "email_template"
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE "email_template" ADD CONSTRAINT "email_template_name_not_blank"
	CHECK (length(btrim(name)) > 0);

ALTER TABLE "email_template" ADD CONSTRAINT "email_template_subject_not_blank"
	CHECK (length(btrim(subject)) > 0);

ALTER TABLE "email_template" ADD CONSTRAINT "email_template_body_not_blank"
	CHECK (length(btrim(body)) > 0);

-- Only 'day_register_pdf' and 'day_register_csv' exist to generate at send
-- time this wave. A text array with a CHECK, not a pg enum, mirrors
-- `document.owner_type`: adding 'invoice_pdf' (#26) and 'expense_receipts'
-- once their source tables exist is a DROP/ADD of this constraint, never an
-- `ALTER TYPE ... ADD VALUE`.
ALTER TABLE "email_template" ADD CONSTRAINT "email_template_attachment_kinds_known"
	CHECK (attachment_kinds <@ ARRAY['day_register_pdf', 'day_register_csv']::text[]);

-- {kind:'on_issue'}, {kind:'manual'} or {kind:'days_before_due', days}, the
-- same discriminated-union-as-jsonb validation `contract.payment_terms`
-- already uses.
ALTER TABLE "email_template" ADD CONSTRAINT "email_template_trigger_shape"
	CHECK (
		(trigger ->> 'kind') IN ('on_issue', 'manual')
		OR (
			(trigger ->> 'kind') = 'days_before_due'
			AND (trigger ->> 'days') ~ '^[0-9]+$'
			AND (trigger ->> 'days')::int > 0
		)
	);

-- Never actually runs: `sent_email_immutable`, below, rejects every UPDATE
-- outright. Kept anyway so this table looks like every other one at a
-- glance, per AGENTS.md's column conventions (see `approval_set_updated_at`
-- for the same reasoning).
CREATE TRIGGER sent_email_set_updated_at BEFORE UPDATE ON "sent_email"
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE "sent_email" ADD CONSTRAINT "sent_email_subject_not_blank"
	CHECK (length(btrim(subject)) > 0);

ALTER TABLE "sent_email" ADD CONSTRAINT "sent_email_message_id_not_blank"
	CHECK (length(btrim(message_id)) > 0);

ALTER TABLE "sent_email" ADD CONSTRAINT "sent_email_recipients_present"
	CHECK (jsonb_typeof(recipients) = 'array' AND jsonb_array_length(recipients) > 0);

-- Append-only, at the database level, the same way `approval` is immutable:
-- `raise_immutable_violation` already exists (0011_approval_constraints.sql).
CREATE TRIGGER sent_email_immutable BEFORE UPDATE OR DELETE ON "sent_email"
	FOR EACH ROW EXECUTE FUNCTION raise_immutable_violation();
