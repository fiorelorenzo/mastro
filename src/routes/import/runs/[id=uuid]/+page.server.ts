/**
 * One run, live or replayed (#278,
 * `docs/specs/2026-08-15-extraction-runs-design.md`, "The three views" A
 * and B): the run itself, its transcript so far, and the two fields the
 * page needs but the run row alone cannot give it — the document's own
 * display name (`extraction_run.document_id` is an id, not a name) and
 * the proposal id lifted to the top level so the page never has to read
 * it through `run.proposalId` in one place and a live SSE `status`
 * message's own `proposalId` in another.
 *
 * `404`s through the same `error(404, m...)` shape every neighbouring
 * route uses for an unknown id (`clients/[id]`, `day/[id]`, …) — deny by
 * default (invariant 6) means this route is already behind a session by
 * virtue of not being on `route-guard.ts`'s public list; this is the
 * ordinary "does the row exist" check every one of those routes makes
 * first.
 *
 * `retryAttemptCount`/`retryHasProposals` (#315) are the two facts the
 * page cannot derive from `run` alone to decide whether a retry button
 * belongs here — read once at load time and combined, client-side, with
 * the *live* `status`/`failureKind` the run page already tracks
 * (`$lib/extraction/retry-eligibility.ts`'s own doc comment on why that
 * split exists). The `retry` action below re-derives both fresh, and
 * never trusts a value this `load` produced for an earlier request.
 *
 * `rereadHasInFlightRun` (#404) is the same shape for the "read this
 * conversation again" button: whether *some* run for this document is
 * already `queued`/`running`, which may be a different, newer run than
 * the one this page is showing. `nothingProposedDates` is read only for
 * a work-unit run that ended `nothing_proposed` — the dates that
 * reading found, all of them rejected, which is what makes "nothing to
 * review" read as an answer instead of a shrug.
 */
import { error, fail, redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import * as m from '$lib/paraglide/messages';
import { gatherRetryFacts, retryFailedRun } from '$lib/server/agent/retry';
import {
	gatherRereadFacts,
	nothingProposedDates,
	reReadConversation
} from '$lib/server/agent/reread';
import { getDocument } from '$lib/server/repositories/document';
import { getExtractionRun, listRunEvents } from '$lib/server/repositories/extraction-run';
import { retryBlockReasonMessage } from '../run-status';
import { rereadBlockReasonMessage } from '$lib/extraction/reread-eligibility';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const run = await getExtractionRun(params.id);
	if (!run) error(404, m.extraction_run_not_found());

	const queueDir = env.RUNNER_QUEUE_DIR ?? './data/runner-queue';
	const [events, document, retryFacts, rereadFacts, skippedDates] = await Promise.all([
		listRunEvents(run.id),
		getDocument(run.documentId),
		gatherRetryFacts(run.documentId),
		gatherRereadFacts(run.documentId),
		run.targetType === 'work_unit' && run.status === 'nothing_proposed'
			? nothingProposedDates(queueDir, run)
			: Promise.resolve([])
	]);

	return {
		run,
		events,
		documentOriginalName: document?.originalName ?? null,
		proposalId: run.proposalId,
		retryAttemptCount: retryFacts.attemptCount,
		retryHasProposals: retryFacts.hasProposals,
		rereadHasInFlightRun: rereadFacts.hasInFlightRun,
		nothingProposedDates: skippedDates
	};
};

export const actions: Actions = {
	/** Re-enqueues the failed job from the same archived document (#315).
	 * `retryFailedRun` re-checks eligibility itself before acting — this
	 * action never decides on the page's behalf, only translates its
	 * answer. Success lands on the *new* run's own page, the same
	 * "verifiable" reasoning the design doc gives for a first enqueue
	 * ("Decisions taken here, and their alternatives", #2). */
	retry: async ({ params }) => {
		const run = await getExtractionRun(params.id);
		if (!run) error(404, m.extraction_run_not_found());

		const queueDir = env.RUNNER_QUEUE_DIR ?? './data/runner-queue';
		const outcome = await retryFailedRun(run, queueDir);
		if (!outcome.ok) {
			return fail(400, { retryError: retryBlockReasonMessage(outcome.reason) });
		}
		redirect(303, `/import/runs/${outcome.run.id}`);
	},

	/** Asks for one more extraction of this run's conversation (#404).
	 * `reReadConversation` re-checks eligibility itself, fresh, before
	 * acting — the same "never trust the page's own read" shape `retry`
	 * above already follows. Success lands on the *new* run's own page,
	 * so the job that was just queued is the one thing on screen next. */
	reread: async ({ params }) => {
		const run = await getExtractionRun(params.id);
		if (!run) error(404, m.extraction_run_not_found());

		const queueDir = env.RUNNER_QUEUE_DIR ?? './data/runner-queue';
		const outcome = await reReadConversation(run.documentId, queueDir);
		if (!outcome.ok) {
			return fail(400, { rereadError: rereadBlockReasonMessage(outcome.reason) });
		}
		redirect(303, `/import/runs/${outcome.run.id}`);
	}
};
