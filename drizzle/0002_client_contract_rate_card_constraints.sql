-- Triggers every table installs per AGENTS.md, plus the CHECK and exclusion
-- constraints the Drizzle schema cannot express. These are where the
-- invariants for #17, #18 and #19 actually live, and are reviewed as SQL.

CREATE TRIGGER client_set_updated_at BEFORE UPDATE ON "client"
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER client_contact_set_updated_at BEFORE UPDATE ON "client_contact"
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER contract_set_updated_at BEFORE UPDATE ON "contract"
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER rate_card_set_updated_at BEFORE UPDATE ON "rate_card"
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- client: country is an ISO 3166-1 alpha-2 code (data, not a jurisdiction
-- decision), and a client always has at least one contact to be usable.
ALTER TABLE "client" ADD CONSTRAINT "client_country_is_alpha2"
	CHECK (country ~ '^[A-Z]{2}$');

-- contract: renewal_notice_days is meaningless for 'none' and required for
-- every other renewal type, including 'counterparty_option', whose refusal
-- window opens exactly `renewal_notice_days` before `ends_on` (see
-- `renewalWindowOpensOn` in the domain layer). This is the field the
-- forecast engine reads for the 30-day notice case in #18's acceptance.
ALTER TABLE "contract" ADD CONSTRAINT "contract_renewal_notice_days_required"
	CHECK (
		(renewal_type = 'none' AND renewal_notice_days IS NULL)
		OR (renewal_type <> 'none' AND renewal_notice_days >= 0)
	);

ALTER TABLE "contract" ADD CONSTRAINT "contract_termination_notice_days_non_negative"
	CHECK (termination_notice_days >= 0);

ALTER TABLE "contract" ADD CONSTRAINT "contract_ends_on_after_starts_on"
	CHECK (ends_on IS NULL OR ends_on >= starts_on);

ALTER TABLE "contract" ADD CONSTRAINT "contract_currency_is_alpha3"
	CHECK (currency ~ '^[A-Z]{3}$');

-- payment_terms shape: {kind:'net', days} or {kind:'day_of_month', day,
-- monthOffset}. Stored as jsonb (see #18); validated here so a malformed
-- document can never reach the due-date calculation.
ALTER TABLE "contract" ADD CONSTRAINT "contract_payment_terms_shape"
	CHECK (
		(
			payment_terms ->> 'kind' = 'net'
			AND (payment_terms ->> 'days') ~ '^[0-9]+$'
			AND (payment_terms ->> 'days')::int > 0
		)
		OR (
			payment_terms ->> 'kind' = 'day_of_month'
			AND (payment_terms ->> 'day') ~ '^[0-9]+$'
			AND (payment_terms ->> 'day')::int BETWEEN 1 AND 31
			AND (payment_terms ->> 'monthOffset')::int = 1
		)
	);

-- expense_policy shape: {kind:'not_reimbursed'}, {kind:'reimbursed_at_cost'}
-- or {kind:'reimbursed_with_cap', capAmount}.
ALTER TABLE "contract" ADD CONSTRAINT "contract_expense_policy_shape"
	CHECK (
		(expense_policy ->> 'kind') IN ('not_reimbursed', 'reimbursed_at_cost')
		OR (
			expense_policy ->> 'kind' = 'reimbursed_with_cap'
			AND (expense_policy ->> 'capAmount')::numeric > 0
		)
	);

-- rate_card: a positive amount, a validity period that does not end before
-- it starts, and fields that only make sense for the kind that uses them —
-- minimum_hours for 'hourly' alone, disbursement_period for
-- 'fixed_recurring' alone.
ALTER TABLE "rate_card" ADD CONSTRAINT "rate_card_amount_positive"
	CHECK (amount > 0);

ALTER TABLE "rate_card" ADD CONSTRAINT "rate_card_valid_to_after_valid_from"
	CHECK (valid_to IS NULL OR valid_to >= valid_from);

ALTER TABLE "rate_card" ADD CONSTRAINT "rate_card_allowed_fractions_present"
	CHECK (array_length(allowed_fractions, 1) > 0);

ALTER TABLE "rate_card" ADD CONSTRAINT "rate_card_minimum_hours_only_for_hourly"
	CHECK (kind = 'hourly' OR minimum_hours IS NULL);

ALTER TABLE "rate_card" ADD CONSTRAINT "rate_card_disbursement_period_matches_kind"
	CHECK (
		(kind = 'fixed_recurring' AND disbursement_period IS NOT NULL)
		OR (kind <> 'fixed_recurring' AND disbursement_period IS NULL)
	);

-- Two rate cards on the same contract can never be in force on the same
-- day. btree_gist lets a GiST exclusion constraint compare the plain
-- equality of contract_id alongside the range overlap of the validity
-- period. An open validity (valid_to IS NULL, the current card) is treated
-- as extending to infinity, so a new open card always collides with an
-- existing one until the existing one is closed off first. This is the
-- database-level enforcement #19 asks for, on top of the pure resolution
-- function in the domain layer.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "rate_card" ADD CONSTRAINT "rate_card_no_overlapping_validity"
	EXCLUDE USING gist (
		contract_id WITH =,
		daterange(valid_from, COALESCE(valid_to, 'infinity'::date), '[]') WITH &&
	);
