// #404: the human trigger that asks for one more extraction of a
// conversation. Rejecting a proposal is a decision about that proposal,
// not a way to ask for another attempt — the enqueue guard
// (`lastExtractionByDocument`, #403) only re-reads a conversation when a
// *new message* arrives, so a conversation a human rejected stays read
// exactly once, forever, however wrong or stale that one reading turns
// out to be. This is the explicit, human-driven surface that asks anyway.
//
// One click enqueues one job for the conversation, through
// `buildConversationExtractionRequest` (`agent/enqueue.ts`) — the exact
// same builder a scheduled enqueue uses, not a second copy of it that
// could drift. It is deliberately never called from anywhere a scheduler
// tick reaches: the only callers are the two form actions this powers
// (the registry's run page, and the review queue's rejected-history
// list), both human-driven.
//
// Kept out of `enqueue.ts` on purpose, the same reasoning that file gives
// for staying out of `mail/poll.ts`: that file is the automatic sweep,
// this is the human override of its own guard, and they meet only at
// `buildConversationExtractionRequest` and the `extraction_run` table.

import { db, type DbExecutor } from '$lib/server/db';
import { rereadEligibility, type RereadBlockReason } from '$lib/extraction/reread-eligibility';
import { buildConversationExtractionRequest } from './enqueue';
import { parseExtractedDays } from './day-extraction';
import {
	createExtractionRun,
	hasInFlightExtractionRun,
	type ExtractionRunRow
} from '$lib/server/repositories/extraction-run';
import {
	getInboundThreadForDocument,
	loadConversations,
	type ArchivedInboundThreadRow
} from '$lib/server/repositories/inbound-thread';
import { getDocuments } from '$lib/server/repositories/document';
import { enqueueJob, readAppliedJob } from '$lib/server/runner/queue';

export interface RereadFacts {
	readonly hasInFlightRun: boolean;
}

/** The one fact {@link rereadEligibility} needs beyond the conversation
 * itself — read fresh by both the offering page's own `load` (for
 * display) and {@link reReadConversation} (for the authoritative check
 * right before acting), so the two never reason from different data. */
export async function gatherRereadFacts(
	documentId: string,
	executor: DbExecutor = db
): Promise<RereadFacts> {
	return { hasInFlightRun: await hasInFlightExtractionRun(documentId, executor) };
}

export type RereadOutcome =
	| { readonly ok: true; readonly run: ExtractionRunRow }
	| { readonly ok: false; readonly reason: RereadBlockReason };

/**
 * Enqueues one more extraction job for the conversation anchored on
 * `documentId`, once {@link gatherRereadFacts} clears
 * {@link rereadEligibility} — checked again here, never trusted from an
 * earlier read, so two tabs asking for the same conversation at once
 * cannot both slip past the in-flight guard.
 *
 * Works whether or not `documentId` has ever had an `extraction_run` row:
 * the five proposals that prompted #404 were extracted before mailbox
 * extractions recorded a run at all, and `getInboundThreadForDocument`
 * — unlike `listInboundThreadsAwaitingExtraction`, which permanently
 * excludes a document with any proposal, whatever its status — finds the
 * conversation regardless of what was ever decided about it.
 */
export async function reReadConversation(
	documentId: string,
	queueDir: string,
	executor: DbExecutor = db
): Promise<RereadOutcome> {
	const facts = await gatherRereadFacts(documentId, executor);
	const eligibility = rereadEligibility(facts);
	if (!eligibility.canReread) return { ok: false, reason: eligibility.reason! };

	const thread = await getInboundThreadForDocument(documentId, executor);
	if (!thread || thread.documentId === null || thread.contractId === null) {
		return { ok: false, reason: 'not_rereadable' };
	}
	// Narrowed once, here, rather than asserted at each use: `documentId`
	// is nullable on the row and non-null for an archived one, which the
	// `inbound_thread_archived_shape` check guarantees and the type
	// cannot express (mirrors `agent/retry.ts`'s own narrowing).
	const archivedThread: ArchivedInboundThreadRow = { ...thread, documentId: thread.documentId };
	const [conversationRows = [archivedThread]] = await loadConversations([archivedThread], executor);
	const documents = await getDocuments(
		conversationRows.map((row) => row.documentId),
		executor
	);
	const documentsById = new Map(documents.map((document) => [document.id, document]));

	const request = await buildConversationExtractionRequest(
		documentId,
		thread.contractId,
		conversationRows,
		documentsById
	);
	if (!request) return { ok: false, reason: 'not_rereadable' };

	const enqueuedAt = new Date();
	const jobId = await enqueueJob(queueDir, request);
	const run = await createExtractionRun(
		{ jobId, documentId, targetType: 'work_unit', enqueuedAt },
		executor
	);
	return { ok: true, run };
}

/**
 * The dates a `nothing_proposed` work-unit run actually found in the
 * conversation, for its own detail page (#404's acceptance: "the dates it
 * skipped visible in the run's own detail"). Read back from
 * `applied/<jobId>.json` — the same file `markJobApplied`'s own doc
 * comment says is kept as the evidence behind a proposal, read here for a
 * run that produced none, rather than persisted a second time: every date
 * in a `nothing_proposed` run's own answer was, by definition, rejected
 * (`day-producer.ts`'s `writeDayProposals` only reaches `nothing_proposed`
 * when nothing survived validation), so nothing here needs the specific
 * per-day reason to answer "what did this reading find".
 *
 * Empty when there is nothing to show: the job never reached `applied/`,
 * or its own `proposedFields` cannot be read as days (`parseExtractedDays`
 * throwing is a display concern here, not this function's to propagate —
 * the run's own terminal status already stands on its own).
 */
export async function nothingProposedDates(
	queueDir: string,
	run: Pick<ExtractionRunRow, 'jobId'>
): Promise<string[]> {
	const job = await readAppliedJob(queueDir, run.jobId);
	if (!job) return [];
	try {
		const days = parseExtractedDays(
			job.result.proposedFields,
			job.request.conversation?.length ?? 1
		);
		return [...new Set(days.map((day) => day.date))].sort();
	} catch {
		return [];
	}
}
