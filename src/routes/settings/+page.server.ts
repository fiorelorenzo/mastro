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
import { detectAgentRunFailure, detectBackupFailure } from '$lib/server/alerts/detectors';
import { fetchLatestAgentRun, fetchLatestBackupRun } from '$lib/server/alerts/repository';
import { classifyRun, mailboxPollHealth } from '$lib/server/alerts/run-health';
import { resolveActiveFiscalPack } from '$lib/server/fiscal/profile';
import { vapidPublicKeyFromEnv } from '$lib/server/push/config';
import { getPracticeProfile } from '$lib/server/repositories/practice-profile';
import { runnerConfiguredInEnv } from '$lib/server/runner/status';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const today = new Date().toISOString().slice(0, 10);
	const now = new Date();
	const runnerConfigured = runnerConfiguredInEnv();

	// `mailboxPollHealth` rather than `fetchLatestMailboxPollRun` directly
	// (#374): the raw fetch answers one conflated question - is an account
	// configured *and* is a folder mapped - and this screen was rendering a
	// false "IMAP is not configured" for an instance that had working
	// credentials and simply nothing mapped yet. The reducer is the same one
	// `/mail` and `/mail/contracts/[id]` read, so the three screens now
	// answer with one implementation instead of three readings of a boolean
	// (#351, #352 fixed the other two).
	const [activeFiscalPack, practiceProfile, latestBackup, mailboxPoll, latestAgentRun] =
		await Promise.all([
			resolveActiveFiscalPack(db, today),
			getPracticeProfile(db),
			fetchLatestBackupRun(db),
			mailboxPollHealth(db),
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
		// The three facts kept apart, exactly as `/mail` receives them, so
		// the row can say "configured, nothing mapped" instead of collapsing
		// that into "not configured".
		mail: {
			accountConfigured: mailboxPoll.accountConfigured,
			anyFolderMapped: mailboxPoll.anyFolderMapped,
			health: mailboxPoll.health
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
