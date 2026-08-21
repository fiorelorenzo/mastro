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
	pendingDayProposalsByDate,
	recordedDaysByDate,
	reviseDayProposal,
	type ProposalRow
} from '$lib/server/repositories/proposal';
import {
	clearDayReadingConflict,
	recordDayReadingConflict
} from '$lib/server/repositories/day-reading-conflict';
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
	const { recordedByDate, ...extractionCtx } = await extractionContext(source, executor);
	const context = {
		...extractionCtx,
		fallbackExcerpt: candidate.excerpt
	};
	const { accepted, rejected: rejectedByValidation } = validateDays(
		parseExtractedDays(candidate.proposedFields, source.conversation?.length ?? 1),
		context
	);
	// Mutable copy: a day can still fail *after* validation, when the revise
	// it resolves to loses a race with a human decision (see the `existing`
	// branch below) — that outcome has to land somewhere in `rejected` too,
	// not be dropped, so this is built up alongside `proposals` rather than
	// returned straight from `validateDays`.
	const rejected: RejectedDay[] = [...rejectedByValidation];

	// Fetched once per run, not once per day: a re-read of a conversation
	// with several days in it must see all of them, since two of `accepted`
	// can land on the same pre-existing pending proposal's date only if the
	// model itself repeated a date, which `seen` in `day-extraction.ts`
	// already refuses.
	const pendingByDate = executor
		? await pendingDayProposalsByDate(source.contractId, executor)
		: await pendingDayProposalsByDate(source.contractId);

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
		// Exactly the fields `applyProposal` reads when a human accepts, and
		// nothing else: a proposal carrying more than the target row needs
		// invites a reviewer to edit something that will be ignored.
		const proposedFields = {
			date: day.date,
			quantity: day.quantity,
			scope: day.scope,
			...(day.notes === undefined ? {} : { notes: day.notes })
		};
		// The message the day's own evidence actually came from (#400), not
		// always the newest one: the Polymarket allocation's offer is
		// message 0, the owner's "confermo" is message 1, and the proposal
		// has to archive against the offer. Falls back to the top-level
		// document when there is no conversation array to resolve against.
		const documentId = source.conversation?.[day.messageIndex]?.documentId ?? source.documentId;

		const existing = pendingByDate.get(day.date);
		if (existing) {
			// Rewritten, not replaced (Task 5): the id is what a link a
			// reviewer already has open resolves to, and `status` stays
			// `pending` because a revision is not a decision. `documentId`
			// moves with `excerpt` even when they differ from `existing`'s —
			// see `reviseDayProposal`'s own doc comment for why re-attributing
			// the evidence to a different message is correct here, not a bug,
			// and why the queue card it lands on is expected to change too.
			const revised = await reviseDayProposal(
				existing.id,
				{ proposedFields, excerpt: day.excerpt, confidence, confidenceReason, documentId },
				executor
			);
			if (revised) {
				proposals.push(revised);
			} else {
				// `existing` was read moments ago from `pendingByDate`, and a
				// human decided it before this UPDATE ran — `reviseDayProposal`
				// found no pending row left to rewrite. Neither
				// `createProposal` nor silence is right here: writing a new
				// proposal would duplicate an accepted day, dropping the day
				// would lose a rejected one's correction, and the caller
				// cannot tell which happened from here. Recorded as rejected
				// instead, visibly, so nothing vanishes; the next run reads
				// fresh state (`recordedDaysByDate`/`pendingDayProposalsByDate`)
				// and does the right thing either way.
				rejected.push({
					day,
					reason: `${day.date}'s proposal was decided while this re-read was running`
				});
			}
			continue;
		}
		proposals.push(
			await createProposal(
				{
					documentId,
					contractId: source.contractId,
					targetType: 'work_unit',
					// The day's own span, not the message-level one: the review
					// screen shows this next to the day, and a reviewer checking
					// a Friday should not have to read the sentence about
					// Thursday to do it.
					proposedFields,
					excerpt: day.excerpt,
					confidence,
					confidenceReason
				},
				executor
			)
		);
	}

	// A reading that disagrees with a day already on the ledger is not
	// suppressed information, it is a thing a reviewer needs to know: the
	// ledger is not touched (that decision was theirs) and the disagreement
	// is written down for the alert engine, which cannot re-invoke the
	// model to rediscover it.
	for (const entry of rejected) {
		if (!entry.reason.endsWith('is already recorded on this contract')) continue;
		const recordedQuantity = recordedByDate.get(entry.day.date);
		if (recordedQuantity !== undefined && recordedQuantity === entry.day.quantity) {
			// A re-read that confirms what the ledger already holds is not
			// news; clear any conflict an earlier, disagreeing reading left
			// behind so a stale alert cannot outlive the disagreement it
			// once described.
			await clearDayReadingConflict(source.contractId, entry.day.date, executor);
			continue;
		}
		const documentId =
			source.conversation?.[entry.day.messageIndex]?.documentId ?? source.documentId;
		await recordDayReadingConflict(
			{
				contractId: source.contractId,
				date: entry.day.date,
				documentId,
				extractionRunId: null,
				proposedFields: {
					date: entry.day.date,
					quantity: entry.day.quantity,
					scope: entry.day.scope
				},
				excerpt: entry.day.excerpt
			},
			executor
		);
	}

	return { proposals, rejected };
}

/** `DayExtractionContext` plus the recorded-day map itself, not just the
 * keys `alreadyDecided` carries. Task 6's own conflict check needs the
 * total quantity each recorded date holds: it is what tells a disagreeing
 * re-read from one that merely confirms the ledger, and `validateDays` has
 * no use for it, so it never enters `DayExtractionContext` itself. */
interface ExtractionContext extends DayExtractionContext {
	readonly recordedByDate: ReadonlyMap<string, number>;
}

async function extractionContext(
	source: DayProposalSource,
	executor?: DbExecutor
): Promise<ExtractionContext> {
	const rateCards = executor
		? await listRateCards(source.contractId, executor)
		: await listRateCards(source.contractId);
	// What the contract actually sells, deduplicated across rate cards and
	// their validity periods: a day at a fraction no card prices is not
	// something a human can accept into an invoice later.
	const allowedQuantities = [
		...new Set(rateCards.flatMap((card) => card.allowedFractions.map(Number)))
	];
	const recorded = executor
		? await recordedDaysByDate(source.contractId, executor)
		: await recordedDaysByDate(source.contractId);
	return {
		startsOn: source.startsOn,
		endsOn: source.endsOn,
		messageDate: source.messageDate,
		allowedQuantities,
		alreadyDecided: new Set(recorded.keys()),
		content: source.content,
		recordedByDate: recorded
	};
}
