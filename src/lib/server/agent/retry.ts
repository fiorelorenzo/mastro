// #315: the human trigger that re-enqueues a failed extraction. Mirrors
// the "archive now, extract later" shape `import/contracts/+page.server.ts`
// and `invoices/propose/+page.server.ts` already draw for a first
// enqueue — this is the same shape for a second attempt at a job whose
// first one failed, rebuilt from the same archived document (invariant
// 4: the source document is never re-derived from anything the failed
// attempt itself produced, since a refused or missing model answer is
// not a source) and never touching the ledger (invariant 3: this only
// ever reaches `enqueueJob` and `createExtractionRun` — writing the
// proposal a successful retry produces is `drainCompletedJobs`'s job,
// unchanged, once the runner answers).
//
// Kept out of `drain.ts` on purpose, the same reasoning `enqueue.ts`
// gives for staying out of `mail/poll.ts`: draining is about turning a
// finished job into a proposal, retrying is about starting a new one,
// and they meet only at the queue directory and the `extraction_run`
// table, not at any shared code.

import { db, type DbExecutor } from '$lib/server/db';
import { retryEligibility, type RetryBlockReason } from '$lib/extraction/retry-eligibility';
import { contractExtractionInstructions } from './contract-extraction';
import { invoiceExtractionInstructions } from './invoice-extraction';
import { dayExtractionInstructions } from './day-extraction';
import {
	loadConversations,
	type ArchivedInboundThreadRow
} from '$lib/server/repositories/inbound-thread';
import {
	renderConversation,
	stripQuotedHistory,
	type ConversationMessage
} from '$lib/server/mail/conversation';
import { decodeMessageBody, parseMessage } from '$lib/server/mail/headers';
import { extractPdfText } from './invoice-producer';
import {
	countExtractionRunsForDocument,
	createExtractionRun,
	type ExtractionRunRow
} from '$lib/server/repositories/extraction-run';
import { listProposalsForDocument } from '$lib/server/repositories/proposal';
import {
	getDocument,
	getDocuments,
	readDocumentBytes,
	type DocumentRow
} from '$lib/server/repositories/document';
import { getInboundThreadForDocument } from '$lib/server/repositories/inbound-thread';
import { enqueueJob } from '$lib/server/runner/queue';
import type { ExtractionRequest } from '$lib/server/runner/types';

export interface RetryFacts {
	readonly attemptCount: number;
	readonly hasProposals: boolean;
}

/** The two facts {@link retryEligibility} needs beyond the run row
 * itself — read fresh by both the run page's own `load` (for display)
 * and {@link retryFailedRun} (for the authoritative check right before
 * acting), so the two never reason from different data. */
export async function gatherRetryFacts(
	documentId: string,
	executor: DbExecutor = db
): Promise<RetryFacts> {
	const [attemptCount, proposals] = await Promise.all([
		countExtractionRunsForDocument(documentId, executor),
		listProposalsForDocument(documentId, executor)
	]);
	return { attemptCount, hasProposals: proposals.length > 0 };
}

export type RetryOutcome =
	| { readonly ok: true; readonly run: ExtractionRunRow }
	| { readonly ok: false; readonly reason: RetryBlockReason };

/**
 * Re-enqueues `run`'s job from the same archived document, once
 * {@link gatherRetryFacts} plus `run`'s own status and `failureKind`
 * clear {@link retryEligibility} — checked again here, never trusted from
 * an earlier read, so two tabs pressing the same button cannot both slip
 * past the attempt bound or both retry a run whose document already
 * picked up proposals from the other one's success.
 */
export async function retryFailedRun(
	run: ExtractionRunRow,
	queueDir: string,
	executor: DbExecutor = db
): Promise<RetryOutcome> {
	const facts = await gatherRetryFacts(run.documentId, executor);
	const eligibility = retryEligibility({
		isFailed: run.status === 'failed',
		failureKind: run.failureKind,
		attemptCount: facts.attemptCount,
		hasProposals: facts.hasProposals
	});
	if (!eligibility.canRetry) return { ok: false, reason: eligibility.reason! };

	const document = await getDocument(run.documentId, executor);
	if (!document) return { ok: false, reason: 'source_missing' };

	// A source that cannot be re-read is a refusal, not a crash. Every
	// other way this can fail already comes back as a `RetryBlockReason`
	// the run page renders, and the material itself failing to parse
	// belongs in the same family: `extractPdfText` throws
	// `InvalidPDFException` on bytes pdfjs cannot open, which reaching the
	// action uncaught answered the operator's button press with a bare 500
	// (found in the browser pass, #315). `source_missing` is the honest
	// reason — the document row exists, but what this run needs from it is
	// not re-readable — and the alternative, a reason of its own, would
	// tell the operator nothing more actionable.
	const request = await buildRetryRequest(run, document, executor).catch(() => null);
	if (!request) return { ok: false, reason: 'source_missing' };

	const jobId = await enqueueJob(queueDir, request);
	const newRun = await createExtractionRun(
		{ jobId, documentId: run.documentId, targetType: run.targetType, enqueuedAt: new Date() },
		executor
	);
	return { ok: true, run: newRun };
}

/** Rebuilds the extraction request the same way the original enqueue for
 * `run.targetType` did — never replaying anything the failed attempt
 * produced, since a refused or missing model answer is not a source
 * document (invariant 4). `null` means the material this run's own
 * `documentId`/`targetType` needs is not there to re-read (a work-unit
 * run whose `inbound_thread` row is somehow gone), which
 * {@link retryFailedRun} reports as `source_missing` rather than
 * guessing at a substitute. */
async function buildRetryRequest(
	run: ExtractionRunRow,
	document: DocumentRow,
	executor: DbExecutor
): Promise<ExtractionRequest | null> {
	switch (run.targetType) {
		case 'contract': {
			const bytes = await readDocumentBytes(document);
			return {
				documentId: run.documentId,
				contractId: document.contractId,
				targetType: 'contract',
				content: await extractPdfText(new Uint8Array(bytes)),
				instructions: contractExtractionInstructions()
			};
		}
		case 'invoice': {
			if (!document.contractId) return null;
			const bytes = await readDocumentBytes(document);
			return {
				documentId: run.documentId,
				contractId: document.contractId,
				targetType: 'invoice',
				content: await extractPdfText(new Uint8Array(bytes)),
				instructions: invoiceExtractionInstructions()
			};
		}
		case 'work_unit': {
			const thread = await getInboundThreadForDocument(run.documentId, executor);
			if (!thread) return null;
			if (thread.documentId === null) return null;
			// Narrowed once, here, rather than asserted at each use: `documentId`
			// is nullable on the row and non-null for an archived one, which the
			// `inbound_thread_archived_shape` check guarantees and the type
			// cannot express.
			const archivedThread: ArchivedInboundThreadRow = {
				...thread,
				documentId: thread.documentId
			};
			// The same conversation a first attempt would have seen (#400).
			// Retrying a mid-thread message against itself alone would give the
			// model strictly less than the run being retried had, which is the
			// opposite of what a retry is for: the Polymarket acceptance on its
			// own reads "tutto ok, confermo" with nothing to confirm.
			const [conversationRows = [archivedThread]] = await loadConversations(
				[archivedThread],
				executor
			);
			const documents = await getDocuments(
				conversationRows.map((row) => row.documentId),
				executor
			);
			const documentsById = new Map<string, DocumentRow>(documents.map((row) => [row.id, row]));
			const conversation: ConversationMessage[] = [];
			for (const row of conversationRows) {
				const archived = documentsById.get(row.documentId);
				if (!archived) continue;
				const bytes = await readDocumentBytes(archived);
				conversation.push({
					documentId: row.documentId,
					sentAt: row.receivedAt.toISOString().slice(0, 10),
					from: row.senderAddress ?? 'unknown',
					body: stripQuotedHistory(decodeMessageBody(parseMessage(bytes)))
				});
			}
			if (conversation.length === 0) return null;
			return {
				documentId: run.documentId,
				contractId: thread.contractId,
				targetType: 'work_unit',
				content: renderConversation(conversation),
				conversation,
				instructions: dayExtractionInstructions(conversation)
			};
		}
	}
}
