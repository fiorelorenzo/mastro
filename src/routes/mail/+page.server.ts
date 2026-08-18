// The status strip (#314) reads `mailboxPollHealth`, the same reducer
// `/settings` uses for its own "Mail polling" row — never a second
// staleness check that could disagree with the alert engine's own
// `detectMailboxPollFailure` (`$lib/server/alerts/run-health.ts`).
import { db } from '$lib/server/db';
import { mailboxPollHealth } from '$lib/server/alerts/run-health';
import { listContractsWithClient } from '$lib/server/repositories/contract';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const [contracts, mailPoll] = await Promise.all([
		listContractsWithClient(),
		mailboxPollHealth(db)
	]);
	return { contracts, mailPoll };
};
