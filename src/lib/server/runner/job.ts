// #82: orchestration for one extraction job — resolve which model gets to
// see this document, call it, and validate its answer into the minimum
// shape a proposal needs. This is deliberately all #82 does with a job's
// result: it never calls `createProposal` (no write access to), and it
// never interprets `proposedFields` beyond checking it is an object —
// what belongs in there is #85/#86/#87's own extraction schema, not
// something this file hardcodes.

import { getDocumentContractId, type RunnerDb } from './db.ts';
import type { ExtractionModel } from './model.ts';
import type { ExtractionRequest, ProposalCandidate } from './types.ts';

/**
 * Runs `request` through the model and returns a `ProposalCandidate` —
 * never a database write.
 *
 * One check happens first: `request.documentId` is re-read from the
 * database and its actual `contractId` compared against
 * `request.contractId`. A mismatch is rejected outright, so a producer bug
 * naming the wrong contract cannot have this document extracted against
 * it. That check is the runner's own, made from its own scoped read rather
 * than trusting the job file.
 */
export async function processExtractionJob(
	sql: RunnerDb,
	model: ExtractionModel,
	request: ExtractionRequest
): Promise<ProposalCandidate> {
	const found = await getDocumentContractId(sql, request.documentId);
	if (!found.found) {
		throw new Error(
			`document ${request.documentId} does not exist, or is not readable by the runner's role`
		);
	}
	if (found.contractId !== request.contractId) {
		throw new Error(
			`document ${request.documentId} belongs to contract ${found.contractId}, not ` +
				`${request.contractId} as the job claimed`
		);
	}

	const { text } = await model.call({
		instructions: request.instructions,
		content: request.content
	});

	return parseExtractionResult(text, request);
}

/**
 * Agents wrap JSON in a fenced block about half the time, whatever the
 * instructions say — Claude Code does, and it is the configured agent.
 * That is a property of the transport rather than of any one producer's
 * prompt, so it is unwrapped here rather than in each of #85/#86/#87. A
 * job that failed on this answered correctly and was thrown away, which
 * is the worst kind of failure: it looks like the model got it wrong.
 *
 * The fence is no longer required to wrap the whole answer (#400). Given a
 * conversation to weigh rather than one message to read, the agent started
 * reasoning out loud first and fencing its answer at the end: measured on
 * the real friday-13th message, 1811 characters of which the last 400 were
 * the JSON. Under the old anchored pattern that parsed as "not valid JSON"
 * - a correct answer discarded, and reported as a model failure.
 *
 * The last fenced block wins, not the first, because an agent that shows
 * its work sometimes quotes the shape it was asked for before filling it
 * in. Locating the answer inside a response is not the "best-effort guess"
 * `parseExtractionResult` refuses to make: nothing here repairs or infers a
 * field, and a response with no fence at all is still handed on whole to
 * fail honestly on its own merits.
 */
export function stripCodeFence(text: string): string {
	const anchored = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/.exec(text);
	if (anchored) return anchored[1];

	const blocks = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
	const last = blocks[blocks.length - 1];
	return last ? last[1].trim() : text;
}

/**
 * Parses a model's raw text as the JSON shape `ExtractionResult` needs.
 * Anything else — unparsable JSON, a missing field, an out-of-range
 * confidence — is a thrown error naming what was wrong, never a
 * best-effort guess at what the model "probably meant".
 */
function parseExtractionResult(text: string, request: ExtractionRequest): ProposalCandidate {
	let parsed: unknown;
	try {
		parsed = JSON.parse(stripCodeFence(text));
	} catch (cause) {
		throw new Error(`model response is not valid JSON: ${truncate(text)}`, { cause });
	}

	if (
		typeof parsed !== 'object' ||
		parsed === null ||
		!('excerpt' in parsed) ||
		!('confidence' in parsed) ||
		!('proposedFields' in parsed)
	) {
		throw new Error(
			`model response is missing one of excerpt/confidence/proposedFields: ${truncate(text)}`
		);
	}

	const { excerpt, confidence, confidenceReason, proposedFields } = parsed as Record<
		string,
		unknown
	>;
	// An excerpt is the evidence for a claim, so a response making no claim
	// has nothing to quote. Requiring one unconditionally put the parser in
	// direct contradiction with the prompt: `day-extraction.ts` tells the
	// model, verbatim, `If the message approves no days, answer
	// {"proposedFields":{"days":[]},"excerpt":"","confidence":1}` - and this
	// line then recorded that exact answer as a model failure. Measured on
	// the live instance: two of eight extractions from a real mailbox landed
	// in `failed` for doing precisely what they were told, which also counts
	// toward `agent_run_failure` and so reports a broken model where the
	// truth is "this message approved nothing".
	//
	// Anything actually proposed still carries its own mandatory excerpt
	// (`parseExtractedDays` refuses a day without one), so invariant 3's
	// "the verbatim excerpt it rests on" is untouched: what is relaxed here
	// is only the case where nothing rests on anything.
	// "Proposes nothing" has to be said explicitly, not merely left out: at
	// least one key, and every one of them an empty array. A bare `{}` stays
	// an error, because for a work-unit extraction it means the `days` key
	// never arrived, which is a model that answered the wrong shape rather
	// than one reporting an empty result.
	const proposesNothing =
		typeof proposedFields === 'object' &&
		proposedFields !== null &&
		!Array.isArray(proposedFields) &&
		Object.keys(proposedFields).length > 0 &&
		Object.values(proposedFields).every((value) => Array.isArray(value) && value.length === 0);
	if (typeof excerpt !== 'string' || (excerpt.trim() === '' && !proposesNothing)) {
		throw new Error(`model response's excerpt is not a non-blank string: ${truncate(text)}`);
	}
	if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) {
		throw new Error(`model response's confidence is not a number in [0, 1]: ${truncate(text)}`);
	}
	if (confidenceReason !== undefined && typeof confidenceReason !== 'string') {
		throw new Error(`model response's confidenceReason is not a string: ${truncate(text)}`);
	}
	if (
		typeof proposedFields !== 'object' ||
		proposedFields === null ||
		Array.isArray(proposedFields)
	) {
		throw new Error(`model response's proposedFields is not an object: ${truncate(text)}`);
	}

	return {
		documentId: request.documentId,
		contractId: request.contractId,
		targetType: request.targetType,
		proposedFields: proposedFields as Record<string, unknown>,
		excerpt,
		confidence,
		...(typeof confidenceReason === 'string' && confidenceReason.trim() !== ''
			? { confidenceReason: confidenceReason.trim() }
			: {})
	};
}

function truncate(text: string): string {
	return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}
