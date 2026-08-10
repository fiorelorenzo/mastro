// #82: orchestration for one extraction job — resolve which model gets to
// see this document, call it, and validate its answer into the minimum
// shape a proposal needs. This is deliberately all #82 does with a job's
// result: it never calls `createProposal` (no write access to), and it
// never interprets `proposedFields` beyond checking it is an object —
// what belongs in there is #85/#86/#87's own extraction schema, not
// something this file hardcodes.

import { getDocumentContractId, type RunnerDb } from './db.ts';
import { resolveProvider } from './routing.ts';
import type { ExtractionModel } from './model.ts';
import type { ExtractionRequest, ProposalCandidate } from './types.ts';

export interface ExtractionModels {
	readonly local: ExtractionModel;
	readonly hosted: ExtractionModel;
}

/**
 * Runs `request` through routing, then the model routing selects, and
 * returns a `ProposalCandidate` — never a database write. Two checks
 * happen before the model is ever touched:
 *
 * 1. `request.documentId` is re-read from the database and its actual
 *    `contractId` is compared against `request.contractId`. A mismatch is
 *    rejected outright — a producer bug pointing a document at the wrong
 *    contract must not be able to borrow that other contract's hosted
 *    consent.
 * 2. `resolveProvider` decides local or hosted from the real database
 *    column, not from `request.requestedProvider` alone — a caller can
 *    ask, it cannot decide.
 *
 * Only after both pass does `models.local`/`models.hosted` get called.
 */
export async function processExtractionJob(
	sql: RunnerDb,
	models: ExtractionModels,
	request: ExtractionRequest
): Promise<ProposalCandidate> {
	const actualContractId = await getDocumentContractId(sql, request.documentId);
	if (actualContractId === null) {
		throw new Error(
			`document ${request.documentId} does not exist, or is not readable by the runner's role`
		);
	}
	if (actualContractId !== request.contractId) {
		throw new Error(
			`document ${request.documentId} belongs to contract ${actualContractId}, not ` +
				`${request.contractId} as the job claimed`
		);
	}

	const provider = await resolveProvider(sql, request.contractId, request.requestedProvider);
	const model = provider === 'hosted' ? models.hosted : models.local;

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
 */
export function stripCodeFence(text: string): string {
	const fenced = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/.exec(text);
	return fenced ? fenced[1] : text;
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

	const { excerpt, confidence, proposedFields } = parsed as Record<string, unknown>;
	if (typeof excerpt !== 'string' || excerpt.trim() === '') {
		throw new Error(`model response's excerpt is not a non-blank string: ${truncate(text)}`);
	}
	if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) {
		throw new Error(`model response's confidence is not a number in [0, 1]: ${truncate(text)}`);
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
		confidence
	};
}

function truncate(text: string): string {
	return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}
