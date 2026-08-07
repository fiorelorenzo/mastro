import { pgEnum, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { id, timestamps } from '../columns';

export const mailboxPollRunStatus = pgEnum('mailbox_poll_run_status', ['success', 'failure']);
export type MailboxPollRunStatus = (typeof mailboxPollRunStatus.enumValues)[number];

/**
 * One row per IMAP poll attempt (#84), written by `pollMailboxesOnce`
 * (`mail/poll.ts`) at the end of every pass regardless of outcome — the
 * same shape `backup_run` (#77) established, reused rather than invented
 * a third time (this issue's own instruction): a single global row, no
 * per-contract or per-folder foreign key, because a provider outage is a
 * property of the one IMAP account this instance authenticates to, not of
 * any one contract's folder. A folder-level problem (a renamed or deleted
 * mailbox for one contract) still surfaces here too, folded into `detail`
 * alongside whichever other folders in the same pass succeeded — nothing
 * about a single misconfigured mapping is worth a second table.
 *
 * The alert engine (#74) is this table's stated reader, the same
 * two-part check `detectBackupFailure` already runs: an explicit
 * `failure` row (`'failure'` beats any older row, `'success'` clears it),
 * or staleness — nothing recorded recently enough, which a `failure` row
 * can never cover because nothing ran to write one. See
 * `detectMailboxPollFailure` in `alerts/detectors.ts`.
 */
export const mailboxPollRun = pgTable('mailbox_poll_run', {
	id: id(),
	status: mailboxPollRunStatus('status').notNull(),
	detail: text('detail'),
	acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
	...timestamps()
});
