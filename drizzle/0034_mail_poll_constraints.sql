-- #84: `updated_at` triggers for the two new tables, the durable
-- seen-marker `inbound_thread` needs to survive a restart without
-- reprocessing a message, a not-blank guard, and the per-contract
-- `mail_folder` uniqueness `contract.ts`'s doc comment promises. Also
-- widens the `alert_type` CHECK constraints (`0032_alert_and_push_
-- constraints.sql`) for the new `mailbox_poll_failure` alert, same
-- metadata-only widening `document_owner_type_known` established.

CREATE TRIGGER inbound_thread_set_updated_at BEFORE UPDATE ON "inbound_thread"
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER mailbox_poll_run_set_updated_at BEFORE UPDATE ON "mailbox_poll_run"
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- UIDs are only stable within one UIDVALIDITY generation for a mailbox:
-- this is the actual "not reprocessed across restarts" guarantee, scoped
-- per contract because each contract's folder has its own UID sequence.
CREATE UNIQUE INDEX "inbound_thread_contract_uid_key"
	ON "inbound_thread" (contract_id, imap_uid_validity, imap_uid);

-- The second, independent safety net for a UIDVALIDITY bump: the same
-- message, re-numbered under a new generation, still carries the same
-- Message-ID, so it is recognised as already handed off rather than
-- handed off a second time. Partial (message_id is not always present)
-- and per-contract (a Message-ID is only guaranteed unique within one
-- mailbox's own history, not globally across every contract's folder).
CREATE UNIQUE INDEX "inbound_thread_contract_message_id_key"
	ON "inbound_thread" (contract_id, message_id)
	WHERE message_id IS NOT NULL;

ALTER TABLE "inbound_thread" ADD CONSTRAINT "inbound_thread_mailbox_not_blank"
	CHECK (length(btrim(mailbox)) > 0);

-- At most one contract may claim a given folder — see `contract.ts`'s
-- doc comment on `mail_folder`. Partial, not a plain unique column,
-- because null (not polled) is the default for every contract and must
-- stay unconstrained.
CREATE UNIQUE INDEX "contract_mail_folder_key"
	ON "contract" (mail_folder)
	WHERE mail_folder IS NOT NULL;

ALTER TABLE "contract" ADD CONSTRAINT "contract_mail_folder_not_blank"
	CHECK (mail_folder IS NULL OR length(btrim(mail_folder)) > 0);

ALTER TABLE "alert_acknowledgement" DROP CONSTRAINT "alert_acknowledgement_type_known";
ALTER TABLE "alert_acknowledgement" ADD CONSTRAINT "alert_acknowledgement_type_known"
	CHECK (alert_type IN (
		'contract_expiring', 'renewal_window_open', 'worked_without_approval',
		'approval_unactioned', 'invoice_overdue', 'billable_period_closed',
		'ceiling_approaching', 'year_end_overrun_risk', 'backup_failure', 'mirror_failure',
		'mailbox_poll_failure'
	));

ALTER TABLE "alert_delivery" DROP CONSTRAINT "alert_delivery_type_known";
ALTER TABLE "alert_delivery" ADD CONSTRAINT "alert_delivery_type_known"
	CHECK (alert_type IN (
		'contract_expiring', 'renewal_window_open', 'worked_without_approval',
		'approval_unactioned', 'invoice_overdue', 'billable_period_closed',
		'ceiling_approaching', 'year_end_overrun_risk', 'backup_failure', 'mirror_failure',
		'mailbox_poll_failure'
	));

ALTER TABLE "alert_preference" DROP CONSTRAINT "alert_preference_type_known";
ALTER TABLE "alert_preference" ADD CONSTRAINT "alert_preference_type_known"
	CHECK (alert_type IN (
		'contract_expiring', 'renewal_window_open', 'worked_without_approval',
		'approval_unactioned', 'invoice_overdue', 'billable_period_closed',
		'ceiling_approaching', 'year_end_overrun_risk', 'backup_failure', 'mirror_failure',
		'mailbox_poll_failure'
	));
