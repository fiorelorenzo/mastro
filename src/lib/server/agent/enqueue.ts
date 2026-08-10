// #85: the front of the loop. Every message the poller (#84) archived and
// has not yet extracted becomes one queued job.
//
// Kept out of `mail/poll.ts` on purpose. Polling is about not losing a
// message; extraction is about reading one, and a mailbox that is
// unreachable should not stop days being proposed from what already
// arrived, nor the reverse. They meet at `inbound_thread`, which the
// poller writes and this reads.

import { listProposalsForDocument } from '$lib/server/repositories/proposal';
import { listInboundThreadsAwaitingExtraction } from '$lib/server/repositories/inbound-thread';
import { getContract } from '$lib/server/repositories/contract';
import { readDocumentBytes, getDocument } from '$lib/server/repositories/document';
import { enqueueJob } from '$lib/server/runner/queue';
import { dayExtractionInstructions } from './day-extraction';

export interface EnqueueOutcome {
	readonly enqueued: number;
	/** Threads skipped because their contract has no consent document on
	 * file. Not an error: it is the normal state of a contract nobody has
	 * asked, and the count is worth seeing so a self-hoster can tell
	 * "nothing arrived" from "nothing may be read". */
	readonly withoutConsent: number;
	readonly alreadyProposed: number;
}

/**
 * Queues one extraction job per archived message that has none yet.
 *
 * The consent check happens here as well as in the runner, and that is
 * not redundant: `routing.ts` refuses a job that should never have been
 * made, which is a loud failure in `failed/` for a human to look at,
 * while this skips making it in the first place. A contract nobody
 * consented for should produce silence, not a queue full of refusals.
 */
export async function enqueueDayExtractions(queueDir: string): Promise<EnqueueOutcome> {
	let enqueued = 0;
	let withoutConsent = 0;
	let alreadyProposed = 0;

	for (const thread of await listInboundThreadsAwaitingExtraction()) {
		const contract = await getContract(thread.contractId);
		if (!contract) continue;
		if (contract.hostedExtractionConsentDocumentId === null) {
			withoutConsent += 1;
			continue;
		}
		if ((await listProposalsForDocument(thread.documentId)).length > 0) {
			alreadyProposed += 1;
			continue;
		}

		const archived = await getDocument(thread.documentId);
		if (!archived) continue;
		// The runner cannot read the blob store (#82's grant does not cover
		// it), so the message body travels in the job.
		const bytes = await readDocumentBytes(archived);

		await enqueueJob(queueDir, {
			documentId: thread.documentId,
			contractId: thread.contractId,
			targetType: 'work_unit',
			content: bytes.toString('utf8'),
			instructions: dayExtractionInstructions(thread.receivedAt.toISOString().slice(0, 10)),
			requestedProvider: 'hosted'
		});
		enqueued += 1;
	}
	return { enqueued, withoutConsent, alreadyProposed };
}
