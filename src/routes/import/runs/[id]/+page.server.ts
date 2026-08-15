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
 */
import { error } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages';
import { getDocument } from '$lib/server/repositories/document';
import { getExtractionRun, listRunEvents } from '$lib/server/repositories/extraction-run';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const run = await getExtractionRun(params.id);
	if (!run) error(404, m.extraction_run_not_found());

	const [events, document] = await Promise.all([
		listRunEvents(run.id),
		getDocument(run.documentId)
	]);

	return {
		run,
		events,
		documentOriginalName: document?.originalName ?? null,
		proposalId: run.proposalId
	};
};
