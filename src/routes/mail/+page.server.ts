// The status strip (#314) reads `mailboxPollHealth`, the same reducer
// `/settings` uses for its own "Mail polling" row — never a second
// staleness check that could disagree with the alert engine's own
// `detectMailboxPollFailure` (`$lib/server/alerts/run-health.ts`).
import { fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { mailboxPollHealth } from '$lib/server/alerts/run-health';
import { listContractsWithClient } from '$lib/server/repositories/contract';
import { imapConfigFromEnv, imapConfiguredInEnv } from '$lib/server/mail/config';
import { pollMailboxesOnce } from '$lib/server/mail/poll';
import { MailPollAlreadyInFlightError, runExclusiveMailPoll } from '$lib/server/mail/poll-lock';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const [contracts, mailPoll] = await Promise.all([
		listContractsWithClient(),
		mailboxPollHealth(db)
	]);
	return { contracts, mailPoll };
};

export const actions: Actions = {
	// #343: a browser button next to the status strip that calls the exact
	// function `/api/mail/poll` calls, authorised the way every other page
	// action on this route is — by the session `hooks.server.ts` already
	// requires for `/mail` (it is not on `route-guard.ts`'s public list) —
	// never by `IMAP_POLL_CRON_TOKEN`. That token exists for exactly one
	// caller, cron, which has no session to present; a signed-in human
	// pressing a button always has one, so handing the token to this action
	// would only be a second, weaker way to authorise the same request
	// (#304's guarantee is that cron's own path never widens).
	//
	// `imapConfiguredInEnv` guards this defensively, in server code, even
	// though the button already hides itself behind `data.mailPoll.configured`
	// (`+page.svelte`) — a disabled or missing button is a UI courtesy, the
	// same principle `runExclusiveMailPoll` exists for below, never a
	// substitute for the server checking its own preconditions.
	pollNow: async () => {
		if (!imapConfiguredInEnv()) {
			return fail(400, { pollNow: { ok: false as const, reason: 'not_configured' as const } });
		}

		let result;
		try {
			// The concurrency bound (#343): `runExclusiveMailPoll` throws
			// before `pollMailboxesOnce` — and therefore before any IMAP
			// connection — is ever attempted, if a poll this process started
			// is still running. See `poll-lock.ts` for why a module-level
			// flag is the right lock for this process's own deployment shape.
			result = await runExclusiveMailPoll(() => pollMailboxesOnce(imapConfigFromEnv()));
		} catch (err) {
			if (err instanceof MailPollAlreadyInFlightError) {
				return fail(409, { pollNow: { ok: false as const, reason: 'in_flight' as const } });
			}
			throw err;
		}

		// Three counts, not two (#380). Watching a whole mailbox means most of
		// what arrives is archived and deliberately not extracted, so folding
		// that into "skipped" - which means the bytes were refused - would
		// read as failure on a perfectly normal inbox.
		const totals = result.folders.reduce(
			(acc, folder) => ({
				archived: acc.archived + folder.handedOff,
				skipped: acc.skipped + folder.skipped,
				unknownSender: acc.unknownSender + folder.archivedUnknownSender
			}),
			{ archived: 0, skipped: 0, unknownSender: 0 }
		);

		if (result.status === 'failure') {
			// Read back through `mailboxPollHealth` — the exact row
			// `pollMailboxesOnce` just wrote — rather than recomputing the
			// failure text here, so the toast this return value drives and
			// the status block below it (refreshed by this action's own
			// navigation) never disagree about why the poll failed. This
			// file's own load function keeps that same rule for the badge.
			const { health } = await mailboxPollHealth(db);
			const detail = health?.kind === 'failure' ? health.detail : null;
			return { pollNow: { ok: true as const, status: 'failure' as const, ...totals, detail } };
		}

		return { pollNow: { ok: true as const, status: 'success' as const, ...totals } };
	}
};
