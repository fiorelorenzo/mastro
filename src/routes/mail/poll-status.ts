// Colocated with `/mail` (#314) so its own status strip and `/settings`'s
// "Mail polling" row (`../settings/+page.svelte`) render the identical
// wording for the identical fact instead of two independent copies —
// `mailbox_poll_run` is one account-wide row, not per-contract (see
// `db/schema/mailbox-poll-run.ts`). #394 removed the per-contract inbound
// folder field this file used to also badge; `/mail/contracts/[id]` no
// longer imports from here. `kind` mirrors `RunHealth`
// (`$lib/server/alerts/run-health.ts`) structurally rather than importing
// it: that module lives under `$lib/server`, and this file is also
// imported from `.svelte` files, where an import from `$lib/server` is a
// build-time error.
import * as m from '$lib/paraglide/messages';
import { formatDateTime } from '$lib/i18n/format';
import type { BadgeVariant } from '$lib/design';
import type { Locale } from '$lib/paraglide/runtime';

export type PollHealthKind = 'ok' | 'failure' | 'stale' | 'never_run';

export interface PollHealthSnapshot {
	readonly kind: PollHealthKind;
	readonly lastRunAt?: string;
	readonly detail?: string | null;
}

/**
 * The badge for the mailbox poller's current state — never colour alone
 * (`BADGE_GLYPH` pairs every variant with its own glyph). `serious` for
 * `stale` mirrors `detectMailboxPollFailure`'s own severity; an explicit
 * failure and "never ran at all" are both `critical`, same as the alert
 * engine fires them.
 *
 * `accountConfigured` used to travel with a second `anyFolderMapped`
 * argument (#351): whether a contract had claimed a folder was a separate
 * problem from whether IMAP was configured at all, with a separate fix.
 * #394 removed the folder mechanism itself — attribution is by sender
 * address, not by which folder a message landed in — so there is no
 * mapping step left to report on. `accountConfigured` is the only
 * precondition now; a `null` health with the account configured cannot
 * happen (`mailboxPollHealth` only omits `health` when the account is
 * not configured), but is treated the same as unconfigured rather than
 * assumed away, since a UI reducer should never crash on a state its own
 * caller could not have produced by construction alone.
 */
export function mailPollBadge(
	accountConfigured: boolean,
	health: PollHealthSnapshot | null
): { variant: BadgeVariant; label: string } {
	if (!accountConfigured || health === null) {
		return { variant: 'warning', label: m.mail_poll_status_not_configured_badge() };
	}
	switch (health.kind) {
		case 'ok':
			return { variant: 'good', label: m.mail_poll_status_ok_badge() };
		case 'failure':
			return { variant: 'critical', label: m.mail_poll_status_failure_badge() };
		case 'stale':
			return { variant: 'serious', label: m.mail_poll_status_stale_badge() };
		case 'never_run':
			return { variant: 'critical', label: m.mail_poll_status_never_run_badge() };
	}
}

/** The prose next to {@link mailPollBadge}'s badge: when it last polled,
 * and what happened — or, before any of that can be true, that IMAP is
 * unconfigured. See {@link mailPollBadge} for why the folder-mapping
 * argument this used to also take is gone (#394). */
export function mailPollMeta(
	accountConfigured: boolean,
	health: PollHealthSnapshot | null,
	locale: Locale
): string {
	if (!accountConfigured || health === null) return m.mail_poll_status_not_configured_meta();
	switch (health.kind) {
		case 'ok':
			return m.mail_poll_status_ok_meta({ date: formatDateTime(health.lastRunAt!, locale) });
		case 'failure':
			return m.mail_poll_status_failure_meta({
				date: formatDateTime(health.lastRunAt!, locale),
				detail: health.detail ?? ''
			});
		case 'stale':
			return m.mail_poll_status_stale_meta({ date: formatDateTime(health.lastRunAt!, locale) });
		case 'never_run':
			return m.mail_poll_status_never_run_meta();
	}
}
