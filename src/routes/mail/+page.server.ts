// The status strip (#314) reads `mailboxPollHealth`, the same reducer
// `/settings` uses for its own "Mail polling" row — never a second
// staleness check that could disagree with the alert engine's own
// `detectMailboxPollFailure` (`$lib/server/alerts/run-health.ts`).
import { fail } from '@sveltejs/kit';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { inboundThread } from '$lib/server/db/schema';
import { mailboxPollHealth } from '$lib/server/alerts/run-health';
import { listContractsWithClient } from '$lib/server/repositories/contract';
import { listUnknownSenderAddresses } from '$lib/server/repositories/inbound-thread';
import { imapConfigFromEnv, imapConfiguredInEnv } from '$lib/server/mail/config';
import { pollMailboxesOnce } from '$lib/server/mail/poll';
import { MailPollAlreadyInFlightError, runExclusiveMailPoll } from '$lib/server/mail/poll-lock';
import type { Actions, PageServerLoad } from './$types';

// #385: the toast a manual poll drives (`pollNow`, below) names the
// archived-unknown count for the one pass that just ran, and is gone on
// the next navigation. Whether ingestion is actually stuck is a standing
// fact of the mailbox, not of the last click, so the status strip needs
// its own persistent read: every `inbound_thread` row already carries
// `archived = true, skip_reason = 'sender_unknown'` for exactly this case
// (`mail/poll.ts`), so a plain count over rows already written is enough
// — no new column, no re-derivation of what the poller decided.
async function countArchivedUnknownSenderThreads(): Promise<number> {
	const [row] = await db
		.select({ total: sql<number>`count(*)`.mapWith(Number) })
		.from(inboundThread)
		.where(and(eq(inboundThread.archived, true), eq(inboundThread.skipReason, 'sender_unknown')));
	return row?.total ?? 0;
}

export const load: PageServerLoad = async () => {
	const [contracts, mailPoll, unknownSenderArchivedCount, unknownSenders] = await Promise.all([
		listContractsWithClient(),
		mailboxPollHealth(db),
		countArchivedUnknownSenderThreads(),
		listUnknownSenderAddresses()
	]);
	return { contracts, mailPoll, unknownSenderArchivedCount, unknownSenders };
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

		// Four counts, not the reduce over several folders this used to be
		// (#380 for the three, #394 for why there is only ever one mailbox
		// left to read from: per-contract folders are gone, so
		// `pollMailboxesOnce` returns one `MailboxPollResult`, not an array).
		// `recovered` (#388) is messages an earlier pass archived unread that
		// this pass could finally attribute, because a contact was added in
		// between - reported so the toast can say so instead of leaving the
		// reader to notice the unknown-senders panel shrank on its own.
		const {
			handedOff: archived,
			skipped,
			archivedUnknownSender: unknownSender,
			recovered
		} = result.mailbox;

		if (result.status === 'failure') {
			// Read back through `mailboxPollHealth` — the exact row
			// `pollMailboxesOnce` just wrote — rather than recomputing the
			// failure text here, so the toast this return value drives and
			// the status block below it (refreshed by this action's own
			// navigation) never disagree about why the poll failed. This
			// file's own load function keeps that same rule for the badge.
			const { health } = await mailboxPollHealth(db);
			const detail = health?.kind === 'failure' ? health.detail : null;
			return {
				pollNow: {
					ok: true as const,
					status: 'failure' as const,
					archived,
					skipped,
					unknownSender,
					recovered,
					detail
				}
			};
		}

		return {
			pollNow: {
				ok: true as const,
				status: 'success' as const,
				archived,
				skipped,
				unknownSender,
				recovered
			}
		};
	}
};
