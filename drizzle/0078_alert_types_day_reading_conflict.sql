-- Widens the `alert_type` CHECK on all three tables that carry one, for the
-- two alerts that say the mail disagrees with a day the ledger holds. The
-- same metadata-only widening `proposal_pending` (0047) and
-- `agent_run_failure` (0045) established: `ALERT_TYPES` is text with a CHECK
-- precisely so a new type is never an `ALTER TYPE ... ADD VALUE`, whose new
-- label cannot be used inside the transaction that adds it.

ALTER TABLE "alert_acknowledgement" DROP CONSTRAINT "alert_acknowledgement_type_known";
ALTER TABLE "alert_acknowledgement" ADD CONSTRAINT "alert_acknowledgement_type_known"
	CHECK (alert_type IN (
		'contract_expiring', 'renewal_window_open', 'worked_without_approval',
		'approval_unactioned', 'invoice_overdue', 'billable_period_closed',
		'ceiling_approaching', 'year_end_overrun_risk', 'backup_failure', 'mirror_failure',
		'mailbox_poll_failure', 'agent_run_failure', 'proposal_pending',
		'recorded_day_contradicted', 'pending_proposal_unconfirmed'
	));

ALTER TABLE "alert_delivery" DROP CONSTRAINT "alert_delivery_type_known";
ALTER TABLE "alert_delivery" ADD CONSTRAINT "alert_delivery_type_known"
	CHECK (alert_type IN (
		'contract_expiring', 'renewal_window_open', 'worked_without_approval',
		'approval_unactioned', 'invoice_overdue', 'billable_period_closed',
		'ceiling_approaching', 'year_end_overrun_risk', 'backup_failure', 'mirror_failure',
		'mailbox_poll_failure', 'agent_run_failure', 'proposal_pending',
		'recorded_day_contradicted', 'pending_proposal_unconfirmed'
	));

ALTER TABLE "alert_preference" DROP CONSTRAINT "alert_preference_type_known";
ALTER TABLE "alert_preference" ADD CONSTRAINT "alert_preference_type_known"
	CHECK (alert_type IN (
		'contract_expiring', 'renewal_window_open', 'worked_without_approval',
		'approval_unactioned', 'invoice_overdue', 'billable_period_closed',
		'ceiling_approaching', 'year_end_overrun_risk', 'backup_failure', 'mirror_failure',
		'mailbox_poll_failure', 'agent_run_failure', 'proposal_pending',
		'recorded_day_contradicted', 'pending_proposal_unconfirmed'
	));
