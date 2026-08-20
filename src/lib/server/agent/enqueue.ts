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
	listInboundThreadsAwaitingExtraction,
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
	const documentIds = [...new Set(threads.map((thread) => thread.documentId))];

	const [contracts, documents, existingProposals] = await Promise.all([
		getContractsWithClient(contractIds, executor),
		getDocuments(documentIds, executor),
		listProposalsForDocuments(documentIds, executor)
	]);
	const contractIdsPresent = new Set(contracts.map((contract) => contract.id));
	const documentsById = new Map(documents.map((document) => [document.id, document]));
	const documentIdsWithProposal = new Set(existingProposals.map((row) => row.documentId));

	for (const thread of threads) {
		if (thread.contractId === null) continue;
		if (!contractIdsPresent.has(thread.contractId)) continue;
		if (documentIdsWithProposal.has(thread.documentId)) {
			alreadyProposed += 1;
			continue;
		}

		const archived = documentsById.get(thread.documentId);
		if (!archived) continue;
		// The runner cannot read the blob store (#82's grant does not cover
		// it), so the message body travels in the job. #313 (filed
		// separately, not fixed here): this read is unguarded, so a missing
		// blob throws and fails the whole run. A per-message guard belongs
		// right here, wrapping this call alone — everything above it is
		// already in-memory batch lookups, and everything below is this one
		// message's own job, so a try/catch here can `continue` past a
		// missing blob without touching any other message in the batch.
		const bytes = await readDocumentBytes(archived);

		await enqueueJob(queueDir, {
			documentId: thread.documentId,
			contractId: thread.contractId,
			targetType: 'work_unit',
			content: bytes.toString('utf8'),
			instructions: dayExtractionInstructions(thread.receivedAt.toISOString().slice(0, 10))
		});
		enqueued += 1;
	}
	return { enqueued, alreadyProposed };
}
