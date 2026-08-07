-- #74, #75, #63: `updated_at` triggers for the four new tables, the
-- `alert_type`/`severity_rank` CHECK constraints Drizzle cannot express
-- (see `db/schema/alert.ts`'s doc comment on why `alert_type` is plain
-- text rather than an enum — the same tradeoff `document.owner_type`
-- makes), and blank-field guards on `push_subscription`.

CREATE TRIGGER alert_acknowledgement_set_updated_at BEFORE UPDATE ON "alert_acknowledgement"
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER alert_delivery_set_updated_at BEFORE UPDATE ON "alert_delivery"
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER alert_preference_set_updated_at BEFORE UPDATE ON "alert_preference"
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER push_subscription_set_updated_at BEFORE UPDATE ON "push_subscription"
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Widening this list is a metadata-only migration touching no existing
-- row, same as `document_owner_type_known` — see `db/schema/alert.ts`.
ALTER TABLE "alert_acknowledgement" ADD CONSTRAINT "alert_acknowledgement_type_known"
	CHECK (alert_type IN (
		'contract_expiring', 'renewal_window_open', 'worked_without_approval',
		'approval_unactioned', 'invoice_overdue', 'billable_period_closed',
		'ceiling_approaching', 'year_end_overrun_risk', 'backup_failure', 'mirror_failure'
	));

ALTER TABLE "alert_acknowledgement" ADD CONSTRAINT "alert_acknowledgement_severity_rank_range"
	CHECK (severity_rank BETWEEN 1 AND 3);

ALTER TABLE "alert_acknowledgement" ADD CONSTRAINT "alert_acknowledgement_acknowledged_by_not_blank"
	CHECK (length(btrim(acknowledged_by)) > 0);

ALTER TABLE "alert_delivery" ADD CONSTRAINT "alert_delivery_type_known"
	CHECK (alert_type IN (
		'contract_expiring', 'renewal_window_open', 'worked_without_approval',
		'approval_unactioned', 'invoice_overdue', 'billable_period_closed',
		'ceiling_approaching', 'year_end_overrun_risk', 'backup_failure', 'mirror_failure'
	));

ALTER TABLE "alert_delivery" ADD CONSTRAINT "alert_delivery_severity_rank_range"
	CHECK (severity_rank BETWEEN 1 AND 3);

ALTER TABLE "alert_preference" ADD CONSTRAINT "alert_preference_type_known"
	CHECK (alert_type IN (
		'contract_expiring', 'renewal_window_open', 'worked_without_approval',
		'approval_unactioned', 'invoice_overdue', 'billable_period_closed',
		'ceiling_approaching', 'year_end_overrun_risk', 'backup_failure', 'mirror_failure'
	));

ALTER TABLE "push_subscription" ADD CONSTRAINT "push_subscription_endpoint_not_blank"
	CHECK (length(btrim(endpoint)) > 0);

ALTER TABLE "push_subscription" ADD CONSTRAINT "push_subscription_p256dh_not_blank"
	CHECK (length(btrim(p256dh)) > 0);

ALTER TABLE "push_subscription" ADD CONSTRAINT "push_subscription_auth_not_blank"
	CHECK (length(btrim(auth)) > 0);
