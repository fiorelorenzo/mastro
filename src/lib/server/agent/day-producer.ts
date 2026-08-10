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
import { createProposal, type ProposalRow } from '$lib/server/repositories/proposal';
import type { DbExecutor } from '$lib/server/db';
import type { ProposalCandidate } from '$lib/server/runner/types';
import {
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
	 * the runner cannot read it, by design. */
	readonly content: string;
	/** When the message was sent. Every relative date in it resolves
	 * against this, so it comes from the envelope rather than from the
	 * model's idea of today. */
	readonly messageDate: string;
	readonly startsOn: string;
	readonly endsOn: string | null;
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
	requestedProvider: 'hosted';
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
 * Always asks for the hosted provider, because there is no other one
 * (#81, revised): a contract with no consent document on file is refused
 * by `routing.ts` before any content leaves this process, and that
 * refusal propagates to the caller rather than being swallowed here. A
 * caller that would rather skip such contracts quietly should check the
 * contract first; this function will not decide that on its behalf.
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
		instructions: dayExtractionInstructions(source.messageDate),
		requestedProvider: 'hosted'
	});
	return writeDayProposals(source, candidate, executor);
}

/**
 * The half that writes, split out because the drain (`drain.ts`) already
 * holds a candidate: the runner produced it in its own process and left
 * it on disk, so re-calling the model to get it back would be absurd.
 */
export async function writeDayProposals(
	source: Omit<DayProposalSource, 'messageDate'>,
	candidate: ProposalCandidate,
	executor?: DbExecutor
): Promise<DayProposalOutcome> {
	const context = {
		...(await extractionContext(source, executor)),
		fallbackExcerpt: candidate.excerpt
	};
	const { accepted, rejected } = validateDays(
		parseExtractedDays(candidate.proposedFields),
		context
	);

	const proposals: ProposalRow[] = [];
	for (const day of accepted) {
		proposals.push(
			await createProposal(
				{
					documentId: source.documentId,
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
					confidence: candidate.confidence
				},
				executor
			)
		);
	}
	return { proposals, rejected };
}

async function extractionContext(
	source: Omit<DayProposalSource, 'messageDate'>,
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
	return {
		startsOn: source.startsOn,
		endsOn: source.endsOn,
		allowedQuantities,
		content: source.content
	};
}
