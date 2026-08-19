// Reduces one of #74's own two-part checks — a latest run row plus
// whichever `detect*Failure` already ran against it (`detectors.ts`) — to
// the shape every UI reader of a run's health renders: `ok` / `failure` /
// `stale` / `never_run`. Extracted out of `routes/settings/+page.server.ts`
// (#246, the first reader) so `/mail` (#314, the second) shares the exact
// same reducer instead of a second copy that could drift from it — the
// detectors already own every threshold (`thresholds.ts`); this file owns
// nothing but the shape the alert output gets turned into.
import { db, type DbExecutor } from '$lib/server/db';
import { detectMailboxPollFailure } from './detectors';
import { fetchLatestMailboxPollRun } from './repository';
import type { Alert } from './types';
import { imapConfiguredInEnv } from '$lib/server/mail/config';

export type RunRow = {
	readonly status: 'success' | 'failure';
	readonly detail: string | null;
	readonly createdAt: Date;
};

export type RunHealth =
	| { readonly kind: 'ok'; readonly lastRunAt: string; readonly detail: string | null }
	| { readonly kind: 'failure'; readonly lastRunAt: string; readonly detail: string | null }
	| { readonly kind: 'stale'; readonly lastRunAt: string }
	| { readonly kind: 'never_run' };

/** `alerts` is empty exactly when the run is healthy, in which case
 * `latest` cannot be null: the `never_run` case is exactly the one that
 * always produces an alert, on a null `latest`. `stale` carries no
 * `detail`, by construction: staleness is silence, not a recorded
 * failure reason, so there is nothing for `detail` to hold. */
export function classifyRun(latest: RunRow | null, alerts: readonly Alert[]): RunHealth {
	const detail = alerts[0]?.detail;
	if (
		detail &&
		(detail.type === 'backup_failure' ||
			detail.type === 'mailbox_poll_failure' ||
			detail.type === 'agent_run_failure')
	) {
		if (detail.reason === 'never_run') return { kind: 'never_run' };
		if (detail.reason === 'stale') return { kind: 'stale', lastRunAt: detail.lastRunAt ?? '' };
		return { kind: 'failure', lastRunAt: detail.lastRunAt ?? '', detail: detail.detail };
	}
	return { kind: 'ok', lastRunAt: latest!.createdAt.toISOString(), detail: latest!.detail };
}

/**
 * The mailbox poller's health, read and classified in one call — the same
 * query `/settings` runs, shared with `/mail` (#314) and
 * `/mail/contracts/[id]` so neither page can compute "is polling stale"
 * any differently than the alert engine or than each other.
 *
 * Three states, not two (#351). `fetchLatestMailboxPollRun` collapses "no
 * IMAP account" and "an account, but no contract mapped to a folder" into
 * one `pollingConfigured: false`, which is right for the alert engine — an
 * instance that never opted into ingestion must not be told its poller
 * never ran — and wrong for a screen, because the two have different fixes
 * in different places. The live instance sat for hours with a working
 * account and no contracts, and `/mail` told its owner IMAP was not
 * configured, which sent him to check environment variables that were
 * correct while the scheduler logged the real reason.
 *
 * So `accountConfigured` is the env question and `anyFolderMapped` the
 * ledger one. `configured` is kept, meaning both, so the alert engine and
 * any caller that only needs the old gate reads exactly what it read
 * before.
 */
export async function mailboxPollHealth(executor: DbExecutor = db): Promise<{
	configured: boolean;
	accountConfigured: boolean;
	anyFolderMapped: boolean;
	health: RunHealth | null;
}> {
	const accountConfigured = imapConfiguredInEnv();
	const mailboxPoll = await fetchLatestMailboxPollRun(accountConfigured, executor);
	if (!mailboxPoll.pollingConfigured) {
		return {
			configured: false,
			accountConfigured,
			// The account is the first gate, so a false there says nothing
			// about mapping; only when the account is configured does
			// `pollingConfigured: false` mean "nothing is mapped".
			anyFolderMapped: false,
			health: null
		};
	}
	return {
		configured: true,
		accountConfigured: true,
		anyFolderMapped: true,
		health: classifyRun(
			mailboxPoll.latestRun,
			detectMailboxPollFailure(true, mailboxPoll.latestRun, new Date())
		)
	};
}
