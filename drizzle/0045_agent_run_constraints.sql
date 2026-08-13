-- #222: `updated_at` trigger for the new `agent_run` table, mirroring
-- `mailbox_poll_run_set_updated_at` (0034_mail_poll_constraints.sql).
-- Also widens the `alert_type` CHECK constraints for the new
-- `agent_run_failure` alert, the same metadata-only widening
-- `mailbox_poll_failure` (0034) and `document_owner_type_known` before it
-- established.

CREATE TRIGGER agent_run_set_updated_at BEFORE UPDATE ON "agent_run"
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE "alert_acknowledgement" DROP CONSTRAINT "alert_acknowledgement_type_known";
ALTER TABLE "alert_acknowledgement" ADD CONSTRAINT "alert_acknowledgement_type_known"
	CHECK (alert_type IN (
		'contract_expiring', 'renewal_window_open', 'worked_without_approval',
		'approval_unactioned', 'invoice_overdue', 'billable_period_closed',
		'ceiling_approaching', 'year_end_overrun_risk', 'backup_failure', 'mirror_failure',
		'mailbox_poll_failure', 'agent_run_failure'
	));

ALTER TABLE "alert_delivery" DROP CONSTRAINT "alert_delivery_type_known";
ALTER TABLE "alert_delivery" ADD CONSTRAINT "alert_delivery_type_known"
	CHECK (alert_type IN (
		'contract_expiring', 'renewal_window_open', 'worked_without_approval',
		'approval_unactioned', 'invoice_overdue', 'billable_period_closed',
		'ceiling_approaching', 'year_end_overrun_risk', 'backup_failure', 'mirror_failure',
		'mailbox_poll_failure', 'agent_run_failure'
	));

ALTER TABLE "alert_preference" DROP CONSTRAINT "alert_preference_type_known";
ALTER TABLE "alert_preference" ADD CONSTRAINT "alert_preference_type_known"
	CHECK (alert_type IN (
		'contract_expiring', 'renewal_window_open', 'worked_without_approval',
		'approval_unactioned', 'invoice_overdue', 'billable_period_closed',
		'ceiling_approaching', 'year_end_overrun_risk', 'backup_failure', 'mirror_failure',
		'mailbox_poll_failure', 'agent_run_failure'
	));
