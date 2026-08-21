// #85: the app side of day extraction. One archived message goes in, one
// model call happens, and N `proposal` rows come out — one per day, each
// carrying the span of the message that justifies it.
//
// Why one call and many proposals: "ok for Thursday and Friday, but Friday
// is a half day" is one act of approval and two days that a human may want
// to accept separately (the Thursday is right, the Friday needs editing).
// The runner's job contract is one model call returning one candidate, so
// the fan-out is here, where the database writes already live. The runner
// has no write access and this file never bypasses it: it hands over the
// request and takes back a validated candidate.
//
// This file writes proposals and nothing else. A proposal is not a day:
// invariant 3's other half is that a human accepts it on the review
// screen, which is what actually calls `createWorkUnit`.

import { listRateCards } from '$lib/server/repositories/rate-card';
import {
	createProposal,
	datesAlreadyDecided,
	type ProposalRow
} from '$lib/server/repositories/proposal';
import type { DbExecutor } from '$lib/server/db';
import type { ProposalCandidate } from '$lib/server/runner/types';
import type { ConversationMessage } from '$lib/server/mail/conversation';
import {
	dayConfidence,
	dayExtractionInstructions,
	parseExtractedDays,
	validateDays,
	type DayExtractionContext,
	type RejectedDay
} from './day-extraction';

export interface DayProposalSource {
	readonly documentId: string;
	readonly contractId: string;
	/** The message body, already read from the blob store by the caller —
	 * the runner cannot read it, by design. For a conversation this is
	 * `renderConversation`'s output (`$lib/server/mail/conversation`):
	 * every message the thread holds, oldest first, already separated by
	 * the header the model is told to expect. */
	readonly content: string;
	/** When the (newest) message was sent. Every relative date in a
	 * message with no conversation array below resolves against this, so
	 * it comes from the envelope rather than from the model's idea of
	 * today. */
	readonly messageDate: string;
	readonly startsOn: string;
	readonly endsOn: string | null;
	/**
	 * Every message `content` above renders, oldest first, so a day's
	 * `messageIndex` can be resolved back to the document that actually
	 * carries it (#400) — the Polymarket allocation's offer and its
	 * acceptance are two different messages, and the offer is the one a
	 * proposal has to point at. Optional: a hand-uploaded single message
	 * and a candidate drained before this field existed both legitimately
	 * have no array, and `writeDayProposals` falls back to `documentId`
	 * above for either.
	 */
	readonly conversation?: readonly ConversationMessage[];
}

/** How the extraction is actually run. Injected so this module can be
 * exercised against a scripted answer, and so the one real implementation
 * (the runner's `processExtractionJob`) stays the only thing that talks to
 * a model. */
export type RunExtraction = (request: {
	documentId: string;
	contractId: string;
	targetType: string;
	content: string;
	instructions: string;
}) => Promise<ProposalCandidate>;

export interface DayProposalOutcome {
	readonly proposals: readonly ProposalRow[];
	/** Days the model returned that could not be shown to a human, with the
	 * reason. Not an error and not silently dropped: a model that keeps
	 * proposing days outside the contract's term is a prompt problem, and
	 * this is where it becomes visible. */
	readonly rejected: readonly RejectedDay[];
}

/**
 * Reads `source` with the model and writes one pending proposal per day it
 * approves. A message that approves nothing writes nothing at all, rather
 * than an empty proposal for a human to dismiss.
 *
 */
export async function proposeDaysFromMessage(
	source: DayProposalSource,
	runExtraction: RunExtraction,
	executor?: DbExecutor
): Promise<DayProposalOutcome> {
	const candidate = await runExtraction({
		documentId: source.documentId,
		contractId: source.contractId,
		targetType: 'work_unit',
		content: source.content,
		instructions: dayExtractionInstructions(conversationMessages(source))
	});
	return writeDayProposals(source, candidate, executor);
}

/**
 * The conversation `dayExtractionInstructions` describes and `messageIndex`
 * below is resolved against. `source.conversation` when the caller built
 * one; otherwise a single-element stand-in built from `source` itself, so
 * a caller that only ever knew about one message — every test in this
 * file's own suite, and any candidate drained from before #400 — keeps
 * getting exactly the single-message prompt this file used to hardcode.
 */
function conversationMessages(source: DayProposalSource): readonly ConversationMessage[] {
	return (
		source.conversation ?? [
			{ documentId: source.documentId, sentAt: source.messageDate, from: '', body: source.content }
		]
	);
}

/**
 * The half that writes, split out because the drain (`drain.ts`) already
 * holds a candidate: the runner produced it in its own process and left
 * it on disk, so re-calling the model to get it back would be absurd.
 */
export async function writeDayProposals(
	source: DayProposalSource,
	candidate: ProposalCandidate,
	executor?: DbExecutor
): Promise<DayProposalOutcome> {
	const context = {
		...(await extractionContext(source, executor)),
		fallbackExcerpt: candidate.excerpt
	};
	const { accepted, rejected } = validateDays(
		parseExtractedDays(candidate.proposedFields, source.conversation?.length ?? 1),
		context
	);

	const proposals: ProposalRow[] = [];
	for (const day of accepted) {
		// The model's own confidence and reason, folded together with the
		// year-rollover guard's own (#244): the guard only ever lowers, so a
		// day it caught can never end up looking as settled as the model
		// itself believed.
		const { confidence, confidenceReason } = dayConfidence(
			day,
			candidate.confidence,
			candidate.confidenceReason
		);
		proposals.push(
			await createProposal(
				{
					// The message the day's own evidence actually came from
					// (#400), not always the newest one: the Polymarket
					// allocation's offer is message 0, the owner's "confermo"
					// is message 1, and the proposal has to archive against
					// the offer. Falls back to the top-level document when
					// there is no conversation array to resolve against.
					documentId: source.conversation?.[day.messageIndex]?.documentId ?? source.documentId,
					contractId: source.contractId,
					targetType: 'work_unit',
					// Exactly the fields `applyProposal` reads when a human
					// accepts, and nothing else: a proposal carrying more than
					// the target row needs invites a reviewer to edit something
					// that will be ignored.
					proposedFields: {
						date: day.date,
						quantity: day.quantity,
						scope: day.scope,
						...(day.notes === undefined ? {} : { notes: day.notes })
					},
					// The day's own span, not the message-level one: the review
					// screen shows this next to the day, and a reviewer checking
					// a Friday should not have to read the sentence about
					// Thursday to do it.
					excerpt: day.excerpt,
					confidence,
					confidenceReason
				},
				executor
			)
		);
	}
	return { proposals, rejected };
}

async function extractionContext(
	source: DayProposalSource,
	executor?: DbExecutor
): Promise<DayExtractionContext> {
	const rateCards = executor
		? await listRateCards(source.contractId, executor)
		: await listRateCards(source.contractId);
	// What the contract actually sells, deduplicated across rate cards and
	// their validity periods: a day at a fraction no card prices is not
	// something a human can accept into an invoice later.
	const allowedQuantities = [
		...new Set(rateCards.flatMap((card) => card.allowedFractions.map(Number)))
	];
	const alreadyDecided = executor
		? await datesAlreadyDecided(source.contractId, executor)
		: await datesAlreadyDecided(source.contractId);
	return {
		startsOn: source.startsOn,
		endsOn: source.endsOn,
		messageDate: source.messageDate,
		allowedQuantities,
		alreadyDecided,
		content: source.content
	};
}
