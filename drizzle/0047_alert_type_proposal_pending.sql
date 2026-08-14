-- #229: widens the `alert_type` CHECK constraints for the new
-- `proposal_pending` alert, the same metadata-only widening
-- `agent_run_failure` (0045), `mailbox_poll_failure` (0034) and
-- `document_owner_type_known` before them established. No trigger to add
-- here — `proposal` already carries `proposal_set_updated_at` from
-- 0029_proposal.sql.

ALTER TABLE "alert_acknowledgement" DROP CONSTRAINT "alert_acknowledgement_type_known";
ALTER TABLE "alert_acknowledgement" ADD CONSTRAINT "alert_acknowledgement_type_known"
	CHECK (alert_type IN (
		'contract_expiring', 'renewal_window_open', 'worked_without_approval',
		'approval_unactioned', 'invoice_overdue', 'billable_period_closed',
		'ceiling_approaching', 'year_end_overrun_risk', 'backup_failure', 'mirror_failure',
		'mailbox_poll_failure', 'agent_run_failure', 'proposal_pending'
	));

ALTER TABLE "alert_delivery" DROP CONSTRAINT "alert_delivery_type_known";
ALTER TABLE "alert_delivery" ADD CONSTRAINT "alert_delivery_type_known"
	CHECK (alert_type IN (
		'contract_expiring', 'renewal_window_open', 'worked_without_approval',
		'approval_unactioned', 'invoice_overdue', 'billable_period_closed',
		'ceiling_approaching', 'year_end_overrun_risk', 'backup_failure', 'mirror_failure',
		'mailbox_poll_failure', 'agent_run_failure', 'proposal_pending'
	));

ALTER TABLE "alert_preference" DROP CONSTRAINT "alert_preference_type_known";
ALTER TABLE "alert_preference" ADD CONSTRAINT "alert_preference_type_known"
	CHECK (alert_type IN (
		'contract_expiring', 'renewal_window_open', 'worked_without_approval',
		'approval_unactioned', 'invoice_overdue', 'billable_period_closed',
		'ceiling_approaching', 'year_end_overrun_risk', 'backup_failure', 'mirror_failure',
		'mailbox_poll_failure', 'agent_run_failure', 'proposal_pending'
	));
