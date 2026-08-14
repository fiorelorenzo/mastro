// #86: the app side of contract-from-PDF extraction. One archived,
// first-intake document goes in, one model call happens, and exactly one
// `proposal` row comes out — unlike day extraction's fan-out (#85), a
// contract PDF describes one contract, and whatever it says stays one
// proposal a human decides on as a whole. The runner has no write access
// and this file never bypasses it: it hands over the request and takes
// back a validated candidate, the same shape `day-producer.ts` uses.
//
// This file writes one proposal and nothing else. A proposal is not a
// contract: invariant 3's other half is that a human accepts it on the
// review screen, which is what actually calls `createClient`/
// `createContract`/`createRateCard`/`createClauseNote`
// (`repositories/proposal.ts`'s `applyProposal`, the 'contract' case).

import type { DbExecutor } from '$lib/server/db';
import { createProposal, type ProposalRow } from '$lib/server/repositories/proposal';
import type { ProposalCandidate } from '$lib/server/runner/types';
import {
	contractConfidence,
	contractExtractionInstructions,
	parseExtractedContract,
	validateClauseFlags,
	type RejectedClauseFlag
} from './contract-extraction';

export interface ContractProposalSource {
	readonly documentId: string;
	/** The PDF's own text, already extracted by the caller (`pdftotext
	 * -layout`, run where the document is read from the blob store) — the
	 * runner cannot read the blob store itself, by design. */
	readonly content: string;
}

/** How the extraction is actually run. Injected so this module can be
 * exercised against a scripted answer, and so the one real implementation
 * (the runner's `processExtractionJob`) stays the only thing that talks to
 * a model. Mirrors `day-producer.ts`'s own `RunExtraction`, widened only
 * in `contractId`'s type: a first-intake contract PDF names none. */
export type RunExtraction = (request: {
	documentId: string;
	contractId: string | null;
	targetType: string;
	content: string;
	instructions: string;
}) => Promise<ProposalCandidate>;

export interface ContractProposalOutcome {
	readonly proposal: ProposalRow;
	/** Clause flags the model claimed but could not be shown to a human —
	 * not verbatim in the document, or too short to read as evidence —
	 * kept here for visibility rather than silently dropped, the same
	 * shape `DayProposalOutcome.rejected` gives day extraction's own
	 * refusals. A dropped flag leaves the field it would have explained
	 * `null`; `proposalValidationError` still refuses to accept that
	 * field with no flag left to justify it. */
	readonly rejectedFlags: readonly RejectedClauseFlag[];
}

function normalise(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}

/**
 * Reads `source` with the model and writes one pending proposal for the
 * contract it describes.
 */
export async function proposeContractFromPdf(
	source: ContractProposalSource,
	runExtraction: RunExtraction,
	executor?: DbExecutor
): Promise<ContractProposalOutcome> {
	const candidate = await runExtraction({
		documentId: source.documentId,
		contractId: null,
		targetType: 'contract',
		content: source.content,
		instructions: contractExtractionInstructions()
	});
	return writeContractProposal(source, candidate, executor);
}

/**
 * The half that writes, split out because the drain (`drain.ts`) already
 * holds a candidate: the runner produced it in its own process and left
 * it on disk, so re-calling the model to get it back would be absurd —
 * exactly `day-producer.ts`'s own `writeDayProposals` split.
 */
export async function writeContractProposal(
	source: ContractProposalSource,
	candidate: ProposalCandidate,
	executor?: DbExecutor
): Promise<ContractProposalOutcome> {
	if (!normalise(source.content).includes(normalise(candidate.excerpt))) {
		throw new Error(
			`model's top-level excerpt ${JSON.stringify(candidate.excerpt)} is not verbatim in the document`
		);
	}

	const parsed = parseExtractedContract(candidate.proposedFields);
	const { accepted, rejected } = validateClauseFlags(parsed.clauseFlags, source.content);

	const { confidence, confidenceReason } = contractConfidence(
		candidate.confidence,
		candidate.confidenceReason,
		accepted.length
	);

	const proposal = await createProposal(
		{
			documentId: source.documentId,
			contractId: null,
			targetType: 'contract',
			// Exactly the fields `applyProposal` reads when a human accepts,
			// and nothing else (`day-producer.ts`'s own rule): `client`,
			// `contract` and `rateCards` as the model reported them,
			// `clauseFlags` narrowed to the ones actually quoted from the
			// document, each still carrying `interpretationAdopted: null`
			// until a reviewer's own edit names one.
			proposedFields: {
				client: parsed.client,
				contract: parsed.contract,
				rateCards: parsed.rateCards,
				clauseFlags: accepted
			},
			excerpt: candidate.excerpt,
			confidence,
			confidenceReason
		},
		executor
	);

	return { proposal, rejectedFlags: rejected };
}
