// Settings (#246): "is my instance healthy," answerable in one screen.
// Every row this page renders comes from a repository that already
// exists — the alert engine's own `fetchLatestBackupRun`/
// `fetchLatestMailboxPollRun`/`fetchLatestAgentRun` (`alerts/repository.ts`)
// and its own `detectBackupFailure`/`detectMailboxPollFailure`/
// `detectAgentRunFailure` (`alerts/detectors.ts`) for "is this run healthy
// right now," the fiscal-profile repository (#223) for the regime in
// force, and the practice-profile repository (#258) for the invoice
// issuer block. Nothing here recomputes staleness or failure: this page
// is a second reader of exactly the same two-part check #74 already
// established, never a parallel implementation of it that could drift.
import { db } from '$lib/server/db';
import {
	detectAgentRunFailure,
	detectBackupFailure,
	detectMailboxPollFailure
} from '$lib/server/alerts/detectors';
import {
	fetchLatestAgentRun,
	fetchLatestBackupRun,
	fetchLatestMailboxPollRun
} from '$lib/server/alerts/repository';
import type { Alert } from '$lib/server/alerts/types';
import { resolveActiveFiscalPack } from '$lib/server/fiscal/profile';
import { imapConfiguredInEnv } from '$lib/server/mail/config';
import { vapidPublicKeyFromEnv } from '$lib/server/push/config';
import { getPracticeProfile } from '$lib/server/repositories/practice-profile';
import { runnerConfiguredInEnv } from '$lib/server/runner/status';
import type { PageServerLoad } from './$types';

type RunRow = {
	readonly status: 'success' | 'failure';
	readonly detail: string | null;
	readonly createdAt: Date;
};

export type RunHealth =
	| { readonly kind: 'ok'; readonly lastRunAt: string; readonly detail: string | null }
	| { readonly kind: 'failure'; readonly lastRunAt: string; readonly detail: string | null }
	| { readonly kind: 'stale'; readonly lastRunAt: string }
	| { readonly kind: 'never_run' };

/** Reduces one of #74's own two-part checks — the latest run row plus
 * whichever `detect*Failure` already ran against it — to the shape this
 * page renders. `alerts` is empty exactly when the run is healthy, in
 * which case `latest` cannot be null: the `never_run` case is exactly
 * the one that always produces an alert, on a null `latest`. */
function classifyRun(latest: RunRow | null, alerts: readonly Alert[]): RunHealth {
	const detail = alerts[0]?.detail;
	if (
		detail &&
		(detail.type === 'backup_failure' ||
			detail.type === 'mailbox_poll_failure' ||
			detail.type === 'agent_run_failure')
	) {
		if (detail.reason === 'never_run') return { kind: 'never_run' };
		return { kind: detail.reason, lastRunAt: detail.lastRunAt ?? '', detail: detail.detail };
	}
	return { kind: 'ok', lastRunAt: latest!.createdAt.toISOString(), detail: latest!.detail };
}

export const load: PageServerLoad = async () => {
	const today = new Date().toISOString().slice(0, 10);
	const now = new Date();
	const mailConfigured = imapConfiguredInEnv();
	const runnerConfigured = runnerConfiguredInEnv();

	const [activeFiscalPack, practiceProfile, latestBackup, mailboxPoll, latestAgentRun] =
		await Promise.all([
			resolveActiveFiscalPack(db, today),
			getPracticeProfile(db),
			fetchLatestBackupRun(db),
			fetchLatestMailboxPollRun(mailConfigured, db),
			fetchLatestAgentRun(db)
		]);

	let vapidPublicKey: string | null;
	try {
		vapidPublicKey = vapidPublicKeyFromEnv();
	} catch {
		// Unconfigured is a supported state (mirroring `alerts/settings`'s
		// own load), never a crash — the row shows "not configured" instead.
		vapidPublicKey = null;
	}

	return {
		fiscalProfile: activeFiscalPack
			? {
					displayName: activeFiscalPack.pack.displayName,
					validFrom: activeFiscalPack.profile.validFrom
				}
			: null,
		practiceProfile: practiceProfile
			? { legalName: practiceProfile.legalName, taxId: practiceProfile.taxId }
			: null,
		backup: classifyRun(latestBackup, detectBackupFailure(latestBackup, now)),
		mail: {
			configured: mailboxPoll.pollingConfigured,
			health: mailboxPoll.pollingConfigured
				? classifyRun(
						mailboxPoll.latestRun,
						detectMailboxPollFailure(true, mailboxPoll.latestRun, now)
					)
				: null
		},
		runner: {
			configured: runnerConfigured,
			health: runnerConfigured
				? classifyRun(latestAgentRun, detectAgentRunFailure(latestAgentRun, now))
				: null
		},
		vapidPublicKey
	};
};
