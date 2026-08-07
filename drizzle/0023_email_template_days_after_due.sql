-- #73: widens `email_template_trigger_shape` (0017_email_template_constraints.sql)
-- to accept the dunning trigger `{kind:'days_after_due', days}`, symmetric
-- with `days_before_due`. Drizzle-kit cannot diff a hand-written CHECK
-- constraint's body from the TypeScript union type, so this is a second
-- custom migration rather than something 0018 could have expressed.

ALTER TABLE "email_template" DROP CONSTRAINT "email_template_trigger_shape";

ALTER TABLE "email_template" ADD CONSTRAINT "email_template_trigger_shape"
	CHECK (
		(trigger ->> 'kind') IN ('on_issue', 'manual')
		OR (
			(trigger ->> 'kind') IN ('days_before_due', 'days_after_due')
			AND (trigger ->> 'days') ~ '^[0-9]+$'
			AND (trigger ->> 'days')::int > 0
		)
	);
