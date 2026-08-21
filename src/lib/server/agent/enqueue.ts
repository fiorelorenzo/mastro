// #85: the front of the loop. Every message the poller (#84) archived and
// has not yet extracted becomes one queued job.
//
// Kept out of `mail/poll.ts` on purpose. Polling is about not losing a
// message; extraction is about reading one, and a mailbox that is
// unreachable should not stop days being proposed from what already
// arrived, nor the reverse. They meet at `inbound_thread`, which the
// poller writes and this reads.

import { listProposalsForDocuments } from '$lib/server/repositories/proposal';
import {
	createExtractionRun,
	documentIdsWithExtractionRun
} from '$lib/server/repositories/extraction-run';
import {
	renderConversation,
	stripQuotedHistory,
	type ConversationMessage
} from '$lib/server/mail/conversation';
import { decodeMessageBody, parseMessage } from '$lib/server/mail/headers';
import {
	listInboundThreadsAwaitingExtraction,
	loadConversations,
	type ArchivedInboundThreadRow
} from '$lib/server/repositories/inbound-thread';
import { getContractsWithClient } from '$lib/server/repositories/contract';
import { readDocumentBytes, getDocuments } from '$lib/server/repositories/document';
import { enqueueJob } from '$lib/server/runner/queue';
import { db, type DbExecutor } from '$lib/server/db';
import { dayExtractionInstructions } from './day-extraction';

export interface EnqueueOutcome {
	readonly enqueued: number;
	readonly alreadyProposed: number;
}

/**
 * Queues one extraction job per archived message that has none yet.
 *
 * #308: `listInboundThreadsAwaitingExtraction` is bounded to `limit` rows
 * (default `DEFAULT_EXTRACTION_BATCH_LIMIT`), oldest first, so one call
 * costs one query regardless of backlog size; a backlog bigger than the
 * limit is caught up over several ticks rather than paid for in one. The
 * four lookups the old per-message loop made are batched to one query
 * each across the whole page: contracts via `getContractsWithClient`,
 * documents via `getDocuments`, and existing proposals via
 * `listProposalsForDocuments` — the same batch readers the review queue
 * uses, not a second, parallel way of reading the same tables. The
 * proposal check is still consulted for every message in the batch: it
 * is what stops one email producing two sets of proposals, and the
 * per-message loop below never skips it even though the query already
 * excludes documents with a proposal.
 */
export async function enqueueDayExtractions(
	queueDir: string,
	limit?: number,
	executor: DbExecutor = db
): Promise<EnqueueOutcome> {
	let enqueued = 0;
	let alreadyProposed = 0;

	const threads: ArchivedInboundThreadRow[] = await listInboundThreadsAwaitingExtraction(
		limit,
		executor
	);
	if (threads.length === 0) return { enqueued, alreadyProposed };

	// An unattributed thread cannot be enqueued: the extraction prompt is
	// built around a contract, and inventing one would be the guess this
	// product refuses to make (#380). `listInboundThreadsAwaitingExtraction`
	// already excludes `sender_unknown` rows, so what reaches here with no
	// contract is a message whose sender was known but whose client has more
	// than one active contract - genuinely ambiguous, and left for a human.
	const contractIds = [
		...new Set(threads.map((thread) => thread.contractId).filter((id): id is string => id !== null))
	];
	// The conversations behind the awaiting messages, loaded before anything
	// else is looked up because they decide which documents matter (#400):
	// a conversation's older messages may have been archived, and even
	// extracted, long before the one that is awaiting now.
	const conversations = await loadConversations(threads, executor);
	const conversationsBySeedId = new Map<string, ArchivedInboundThreadRow[]>();
	for (const conversation of conversations) {
		for (const row of conversation) conversationsBySeedId.set(row.id, conversation);
	}

	// Every document of every conversation, not only of the awaiting rows,
	// since the whole exchange travels in the job.
	const documentIds = [
		...new Set([
			...threads.map((thread) => thread.documentId),
			...conversations.flatMap((conversation) => conversation.map((row) => row.documentId))
		])
	];

	const [contracts, documents, existingProposals, extractedDocumentIds] = await Promise.all([
		getContractsWithClient(contractIds, executor),
		getDocuments(documentIds, executor),
		listProposalsForDocuments(documentIds, executor),
		documentIdsWithExtractionRun(documentIds, executor)
	]);
	const contractIdsPresent = new Set(contracts.map((contract) => contract.id));
	const documentsById = new Map(documents.map((document) => [document.id, document]));
	const documentIdsWithProposal = new Set(existingProposals.map((row) => row.documentId));
	// Mutable, because enqueuing a conversation marks all of its messages
	// handled for the rest of this batch: five messages of one negotiation
	// arrive as five awaiting rows, and only the first should produce a job.
	const alreadyExtracted = new Set(extractedDocumentIds);

	for (const thread of threads) {
		if (thread.contractId === null) continue;
		if (!contractIdsPresent.has(thread.contractId)) continue;
		if (documentIdsWithProposal.has(thread.documentId)) {
			alreadyProposed += 1;
			continue;
		}

		const conversationRows = conversationsBySeedId.get(thread.id) ?? [thread];

		// Having a proposal is not the same as having been extracted, and
		// this is where the difference bit (#398). A message that approves
		// nothing produces no proposal, ever, so the check above answers
		// "not extracted yet" for it on every single pass: measured on the
		// live instance, `queued 3` on every scheduler tick, five minutes
		// apart, indefinitely - three newsletters paying for a model call
		// each to re-learn that they approve no days. The run is the record
		// of the attempt, so it is what the guard has to read.
		//
		// Asked of the whole conversation, not just this message (#400).
		// `extraction_run` is one row per *job* - `extraction_run_job_id_unique`
		// says so, and the three views that read it depend on that - so a
		// conversation extracted as one job leaves a row against one document,
		// the anchor. Its siblings have none, and a per-message guard would
		// re-enqueue the same exchange from each of them in turn. Reading it
		// per conversation needs no extra rows and is durable across ticks:
		// any sibling's conversation contains the anchor, and the anchor has
		// the run.
		if (conversationRows.some((row) => alreadyExtracted.has(row.documentId))) {
			alreadyProposed += 1;
			continue;
		}

		// Every archived message of this conversation travels in the job, not
		// just the one that happens to be awaiting (#400). The Polymarket
		// half-day is offered in one message and accepted in the next, so a
		// model handed only the acceptance reads "tutto ok, confermo" with
		// nothing to confirm; and a reply quoting its parent used to re-state
		// the parent's sentence as if it were new, which is where three
		// proposals for one day came from.
		const documentsForRows = conversationRows.map((row) => documentsById.get(row.documentId));

		// The runner cannot read the blob store (#82's grant does not cover
		// it), so the message bodies travel in the job.
		//
		// Guarded per message, which closes #313 for this path and is what
		// makes conversation-level extraction safe at all: reading N blobs
		// where the old shape read one multiplies the chance of meeting a
		// missing file by N, and an older sibling whose bytes have gone must
		// not take down an exchange whose newer messages are perfectly
		// readable. A missing blob is not hypothetical - a database restored
		// without its documents directory is exactly this.
		const messages: ConversationMessage[] = [];
		let anchorReadable = false;
		for (const [index, row] of conversationRows.entries()) {
			const archived = documentsForRows[index];
			if (!archived) continue;
			let bytes: Buffer;
			try {
				bytes = await readDocumentBytes(archived);
			} catch {
				continue;
			}
			if (row.documentId === thread.documentId) anchorReadable = true;
			messages.push({
				documentId: row.documentId,
				sentAt: row.receivedAt.toISOString().slice(0, 10),
				from: row.senderAddress ?? 'unknown',
				// Quoted history and signatures removed here rather than left
				// to the prompt: the same sentence quoted four deep is four
				// chances for the model to read it as a new statement, and it
				// is paid for by the token either way.
				body: stripQuotedHistory(decodeMessageBody(parseMessage(bytes)))
			});
		}
		// The anchor is the one message that cannot be missing: it is what the
		// job is named after and what the runner re-derives its contract from.
		if (!anchorReadable) continue;

		const enqueuedAt = new Date();
		const jobId = await enqueueJob(queueDir, {
			// The anchor stays the awaiting message: the runner re-derives its
			// contract from this id and rejects a job that disagrees, and that
			// check is worth keeping pointed at one document rather than a set.
			documentId: thread.documentId,
			contractId: thread.contractId,
			targetType: 'work_unit',
			content: renderConversation(messages),
			conversation: messages,
			instructions: dayExtractionInstructions(messages)
		});
		// The row the guard above reads next time, and the row #281's three
		// views need. Until now only the hand-driven import created one, so
		// "every extraction is a run you can watch" was false for exactly the
		// extractions nobody watches: on the live instance the registry held
		// two rows while the mailbox had produced eight jobs.
		//
		// One row, against the anchor, because `extraction_run` is one row per
		// *job* (`extraction_run_job_id_unique`) and the three views that read
		// it depend on that. The conversation's other messages are covered by
		// the guard above asking about the conversation rather than the
		// message, which is what makes this correct without a second row per
		// message that the schema would refuse anyway.
		//
		// After the job file, not before, because the run is keyed by the job
		// id. If this insert fails the file is already in `pending/` and the
		// drain's unassociated-job path handles it, so the cost is one
		// unwatched extraction rather than a lost message.
		await createExtractionRun(
			{ jobId, documentId: thread.documentId, targetType: 'work_unit', enqueuedAt },
			executor
		);
		// Locally too, so the remaining awaiting rows of this same
		// conversation skip in this pass rather than waiting for the next.
		for (const row of conversationRows) alreadyExtracted.add(row.documentId);
		enqueued += 1;
	}
	return { enqueued, alreadyProposed };
}
