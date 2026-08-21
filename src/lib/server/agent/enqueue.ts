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
	lastExtractionByDocument
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

	const [contracts, documents, existingProposals, lastExtraction] = await Promise.all([
		getContractsWithClient(contractIds, executor),
		getDocuments(documentIds, executor),
		listProposalsForDocuments(documentIds, executor),
		lastExtractionByDocument(documentIds, executor)
	]);
	const contractIdsPresent = new Set(contracts.map((contract) => contract.id));
	const documentsById = new Map(documents.map((document) => [document.id, document]));
	const documentIdsWithProposal = new Set(existingProposals.map((row) => row.documentId));
	// Mutable, because enqueuing a conversation marks all of its messages
	// handled for the rest of this batch: five messages of one negotiation
	// arrive as five awaiting rows, and only the first should produce a job.
	const extractedAt = new Map(lastExtraction);

	for (const thread of threads) {
		if (thread.contractId === null) continue;
		if (!contractIdsPresent.has(thread.contractId)) continue;
		if (documentIdsWithProposal.has(thread.documentId)) {
			alreadyProposed += 1;
			continue;
		}

		const conversationRows = conversationsBySeedId.get(thread.id) ?? [thread];

		// Has this conversation been extracted since its newest message
		// arrived? That one question replaced two worse ones.
		//
		// "Does this document have a proposal" (#398) answers wrong for a
		// message that legitimately approves nothing: no proposal is ever
		// written, so it looked un-extracted forever and was re-queued every
		// five minutes - measured at `queued 3` on every tick, indefinitely.
		//
		// "Has any message of this conversation been extracted" (#400) is
		// wrong in the other direction, and this is the one that hurt: a reply
		// arriving in a conversation that had already been read found a
		// sibling with a run and was skipped, so a client answering an earlier
		// offer was never read at all. Proven by a test before this line was
		// written, and it is the question a person asks about repeated syncs.
		//
		// Comparing timestamps handles both, and the five-messages-at-once
		// case too: the extraction this pass performs is stamped now, which is
		// later than every message already on disk, so the remaining siblings
		// skip. `extraction_run` stays one row per job
		// (`extraction_run_job_id_unique`), which the three views depend on.
		const newestMessageAt = conversationRows.reduce(
			(newest, row) => (row.receivedAt > newest ? row.receivedAt : newest),
			conversationRows[0].receivedAt
		);
		const lastExtractedAt = conversationRows.reduce<Date | null>((latest, row) => {
			const at = extractedAt.get(row.documentId);
			if (!at) return latest;
			return latest === null || at > latest ? at : latest;
		}, null);
		if (lastExtractedAt !== null && lastExtractedAt >= newestMessageAt) {
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
				// Whose words these are (#409). The prompt raises confidence for
				// an offer met by the other side's agreement, so it has to know
				// which side each message is.
				mine: row.direction === 'outbound',
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
		// Stamped with the enqueue time, which is later than every message
		// already archived, so the guard above reads them as covered.
		for (const row of conversationRows) extractedAt.set(row.documentId, enqueuedAt);
		enqueued += 1;
	}
	return { enqueued, alreadyProposed };
}
