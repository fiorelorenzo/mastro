// Colocated with `/mail` (#314) so the index page's status strip and the
// per-contract inbound-folder field's badge — both `mailbox_poll_run` is
// one account-wide row, never per-contract (see
// `db/schema/mailbox-poll-run.ts`) — render the identical wording for the
// identical fact instead of two independent copies. `kind` mirrors
// `RunHealth` (`$lib/server/alerts/run-health.ts`) structurally rather than
// importing it: that module lives under `$lib/server`, and this file is
// also imported from `.svelte` files, where an import from `$lib/server`
// is a build-time error.
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
 * `accountConfigured` and `anyFolderMapped` are separate arguments because
 * they are separate problems with separate fixes (#351): the first is an
 * environment variable, the second is a contract's Inbound mail field. One
 * boolean for both made `/mail` tell its owner IMAP was not configured on
 * an instance where it was configured and working.
 */
export function mailPollBadge(
	accountConfigured: boolean,
	anyFolderMapped: boolean,
	health: PollHealthSnapshot | null
): { variant: BadgeVariant; label: string } {
	if (!accountConfigured) {
		return { variant: 'warning', label: m.mail_poll_status_not_configured_badge() };
	}
	if (!anyFolderMapped || health === null) {
		return { variant: 'warning', label: m.mail_poll_status_not_mapped_badge() };
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
 * and what happened — or, before any of that can be true, which of the two
 * things is missing and where it is fixed. */
export function mailPollMeta(
	accountConfigured: boolean,
	anyFolderMapped: boolean,
	health: PollHealthSnapshot | null,
	locale: Locale
): string {
	if (!accountConfigured) return m.mail_poll_status_not_configured_meta();
	if (!anyFolderMapped || health === null) return m.mail_poll_status_not_mapped_meta();
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
