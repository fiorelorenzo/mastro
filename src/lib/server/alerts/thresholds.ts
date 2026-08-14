// Every day-count and ratio threshold the detectors in `detectors.ts`
// compare against, in one file so a reviewer checking "is this alert
// hardcoded to a contract, a client or a country" (#74's acceptance) can
// see every constant that decides severity or firing at a glance: none of
// them names a contract, a client or a jurisdiction — they apply
// uniformly to every one, which is what makes them thresholds and not the
// hardcoding the acceptance bullet rules out.

/** Contract deadline alerts (`contract_expiring`, `renewal_window_open`):
 * days remaining until `endsOn` at which severity steps up. Both alerts
 * share one scale — they differ in *whether* they fire (a generic expiry
 * warning vs. an actionable renewal/refusal window), not in how urgent the
 * same number of remaining days is. */
export const CONTRACT_DEADLINE_WARNING_DAYS = 30;
export const CONTRACT_DEADLINE_SERIOUS_DAYS = 14;
export const CONTRACT_DEADLINE_CRITICAL_DAYS = 7;

/** `approval_unactioned`: days since `receivedAt` with no `work_unit`
 * linked before this starts, then escalates, warning. A same-day gap is
 * normal — approval for future work often arrives before the work does. */
export const APPROVAL_UNACTIONED_WARNING_DAYS = 3;
export const APPROVAL_UNACTIONED_SERIOUS_DAYS = 7;
export const APPROVAL_UNACTIONED_CRITICAL_DAYS = 14;

/** `worked_without_approval` (#229): real exposure exists the instant a
 * day enters this state, so there is no "grace period" the way
 * `approval_unactioned` has one — severity starts at `serious`, never
 * `warning`. It does not stay there forever, though: unresolved for this
 * many days or more, it steps up to `critical`, giving delivery dedup
 * (`state.ts`'s `covers`) a strictly higher rank to clear against and
 * re-deliver on — the fix for "the alert fires once, at whatever severity
 * it was ever going to have, and then goes quiet forever". */
export const WORKED_WITHOUT_APPROVAL_CRITICAL_DAYS = 3;

/** `proposal_pending` (#229): days since a proposal was produced with no
 * human decision yet. Same three-step climb as `approval_unactioned`, and
 * the same figures — a human confirming is the entire point of the
 * ingestion loop (invariant 3), so a proposal going unreviewed is exactly
 * as urgent as an approval going unactioned. */
export const PROPOSAL_PENDING_WARNING_DAYS = 3;
export const PROPOSAL_PENDING_SERIOUS_DAYS = 7;
export const PROPOSAL_PENDING_CRITICAL_DAYS = 14;

/** `invoice_overdue`: mirrors the bands `routes/invoices/status.ts`'s
 * `ageingStatus` already established for the same `daysLate` figure, so
 * the ageing table and this alert never disagree about what "seriously
 * late" means for the same invoice. */
export const INVOICE_OVERDUE_SERIOUS_DAYS = 8;
export const INVOICE_OVERDUE_CRITICAL_DAYS = 31;

/** `billable_period_closed`: days past the closed period's own end before
 * "you have unbilled days from last month" becomes "...from a while ago". */
export const BILLABLE_PERIOD_SERIOUS_DAYS = 30;
export const BILLABLE_PERIOD_CRITICAL_DAYS = 60;

/** `ceiling_approaching`: a usage ratio at or above this, among the
 * ceiling's own *active* alert levels, is `serious` rather than `warning`.
 * Below any configured level it does not fire at all — that gate is
 * `activeAlertLevels`, from the pack or contract itself, never this file. */
export const CEILING_SERIOUS_RATIO = 0.9;

/** `year_end_overrun_risk`: how far the projected year-end figure would
 * land past the limit before a forward-looking warning becomes serious,
 * then critical. */
export const OVERRUN_SERIOUS_RATIO = 1.05;
export const OVERRUN_CRITICAL_RATIO = 1.2;

/** `backup_failure`, `mirror_failure`: how long is too long since the
 * last successful run before silence itself is the alert — #77's own
 * daily-backup rehearsal (docs/backup.md) settled on 26 hours for backups
 * ("a daily backup with nothing in the last, say, 26 hours"); mirroring
 * documents has no fixed cadence of its own (it runs whenever a document
 * is pending), so the same figure is reused as "long enough that a
 * healthy, regularly-scheduled publish run should have picked this up". */
export const BACKUP_STALE_HOURS = 26;
export const MIRROR_STALE_HOURS = 26;

/** `mailbox_poll_failure`: how long is too long since the last recorded
 * poll attempt (success or failure — `mailbox_poll_run` writes one every
 * pass, per #84) before silence itself is the alert. Much shorter than
 * `BACKUP_STALE_HOURS`: the recommended cron cadence for #84's poller is
 * every few minutes, not once a day, so a gap measured in hours already
 * means the cron entry itself stopped firing, not merely that no new
 * mail arrived in that window. */
export const MAILBOX_POLL_STALE_HOURS = 3;

/** `agent_run_failure`: how long is too long since the last recorded
 * drain/enqueue turn (#85, #222's scheduler default cadence is every
 * few minutes, the same recommended cadence as the mail poller) before
 * silence itself is the alert. Same figure as `MAILBOX_POLL_STALE_HOURS`
 * for the same reason: a gap measured in hours already means the
 * scheduler stopped calling `/api/agent/run`, not that there was simply
 * nothing to drain or enqueue. */
export const AGENT_RUN_STALE_HOURS = 3;
