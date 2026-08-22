/**
 * Whether a conversation can be asked for one more extraction, and why
 * not when it cannot (#404). Pure, and outside `$lib/server` for the same
 * reason `retry-eligibility.ts` is: both the extraction registry's run
 * page and the review queue's rejected-history list read this to decide
 * whether to render the button at all, and the server action re-derives
 * the same fact fresh (`agent/reread.ts`'s own `gatherRereadFacts`) and
 * calls this again before it acts — never trusting what a page rendered
 * earlier — so the two never drift into two different answers.
 *
 * Unlike a retry, a re-read is never blocked by the *reason* a previous
 * attempt ended: a rejected proposal, an applied one, or no run at all
 * are all fine starting points (that is the whole point of #404 — a
 * rejection is a decision about the proposal, not a refusal to look
 * again). The only thing that can block it is a job already in flight for
 * the same conversation.
 */

import * as m from '$lib/paraglide/messages';

export type RereadBlockReason = 'in_flight' | 'not_rereadable';

export interface RereadFacts {
	/** Whether `documentId` already has an extraction run that is
	 * `queued` or `running` — asking again would queue a second job for
	 * the same conversation while the first is still working. */
	readonly hasInFlightRun: boolean;
}

export interface RereadEligibility {
	readonly canReread: boolean;
	readonly reason: RereadBlockReason | null;
}

export function rereadEligibility(facts: RereadFacts): RereadEligibility {
	if (facts.hasInFlightRun) return { canReread: false, reason: 'in_flight' };
	return { canReread: true, reason: null };
}

/**
 * Why a re-read was not offered, or was refused when asked for anyway, in
 * the reader's own language. Exhaustive over {@link RereadBlockReason}
 * with no `default`, the same discipline `retryBlockReasonMessage`
 * (`routes/import/runs/run-status.ts`) already holds itself to — shared
 * here, rather than duplicated per route, because both surfaces that
 * offer a re-read (the registry and the rejected-history list) need the
 * same vocabulary for the same two reasons.
 */
export function rereadBlockReasonMessage(reason: RereadBlockReason): string {
	switch (reason) {
		case 'in_flight':
			return m.reread_blocked_in_flight();
		case 'not_rereadable':
			return m.reread_blocked_not_rereadable();
	}
}
