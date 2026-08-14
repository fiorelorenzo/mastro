// #87: the app side of invoice-PDF extraction. One archived PDF goes in,
// one model call happens, and at most one `proposal` row comes out —
// unlike day-producer.ts's fan-out (one message can approve several
// days), one invoice PDF is one invoice.
//
// This file writes proposals and nothing else, the same boundary
// day-producer.ts already draws for invariant 3's "no bypass": accepting
// a proposal is what actually calls `createInvoice`
// (`repositories/proposal.ts`'s own `applyProposal`), on the review
// screen, never here. And it is the fallback lane by construction — #87's
// own framing: lower confidence than the deterministic FatturaPA adapter,
// never preferred over it when both exist. This module has no opinion on
// that ordering; it only ever runs on a PDF nothing else already claimed.

import { createProposal, type ProposalRow } from '$lib/server/repositories/proposal';
import type { DbExecutor } from '$lib/server/db';
import type { ProposalCandidate } from '$lib/server/runner/types';
import {
	invoiceExcerptRejectionReason,
	invoiceExtractionInstructions,
	parseExtractedInvoice,
	validateInvoice
} from './invoice-extraction';

export interface InvoiceProposalSource {
	readonly documentId: string;
	readonly contractId: string;
}

/** How the extraction is actually run. Injected so this module can be
 * exercised against a scripted answer, and so the one real implementation
 * (the runner's `processExtractionJob`) stays the only thing that talks to
 * a model — the same seam `day-producer.ts`'s `RunExtraction` already is. */
export type RunExtraction = (request: {
	documentId: string;
	contractId: string;
	targetType: string;
	content: string;
	instructions: string;
}) => Promise<ProposalCandidate>;

export interface InvoiceProposalOutcome {
	readonly proposals: readonly ProposalRow[];
	/** Why no proposal was written, when none was — content the model
	 * could not turn into a usable invoice (bad arithmetic, an excerpt
	 * that is not verbatim), never silently dropped. Not an error and
	 * never thrown: a job that answers correctly still keeps `failed/`
	 * for genuine shape problems (`parseExtractedInvoice` throwing),
	 * mirroring the split `day-producer.ts` already draws. */
	readonly rejected: readonly { readonly reason: string }[];
}

/** Extracts `bytes`'s text — the PDF's own reading order, not a layout
 * reconstruction — via pdf-parse, the same library `register/pdf.test.ts`
 * already uses to round-trip a generated PDF back to text. This is what
 * `runner/types.ts`'s own doc comment means by "PDF text already
 * extracted by the caller": the runner never reads a blob store or holds
 * a PDF library, so the conversion happens here, before the request ever
 * reaches it. */
export async function extractPdfText(bytes: Uint8Array): Promise<string> {
	// Imported here, not at module scope. `pdf-parse` wraps pdfjs, whose
	// own module body touches DOM globals Node does not have, so a static
	// import made *loading this file* throw `DOMMatrix is not defined` in a
	// production bundle — and this file is reached from `drain.ts`, so the
	// whole `/api/agent/run` route 500'd on every scheduler tick and the
	// ingestion loop was dead in production while every test stayed green.
	// A lazy import keeps the failure where it belongs: on the one action
	// that actually needs to read a PDF.
	const { PDFParse } = await import('pdf-parse');
	const parser = new PDFParse({ data: bytes });
	try {
		const { text } = await parser.getText();
		return text;
	} finally {
		await parser.destroy();
	}
}

/**
 * Reads `source`'s archived PDF with the model and writes at most one
 * pending proposal. A PDF the model could not turn into a usable invoice
 * writes nothing at all, the same restraint `day-producer.ts` applies to
 * a message that approves nothing.
 */
export async function proposeInvoiceFromPdf(
	source: InvoiceProposalSource,
	pdfBytes: Uint8Array,
	runExtraction: RunExtraction,
	executor?: DbExecutor
): Promise<InvoiceProposalOutcome> {
	const content = await extractPdfText(pdfBytes);
	const candidate = await runExtraction({
		documentId: source.documentId,
		contractId: source.contractId,
		targetType: 'invoice',
		content,
		instructions: invoiceExtractionInstructions()
	});
	return writeInvoiceProposal(source, content, candidate, executor);
}

/**
 * The half that writes, split out because the drain (`drain.ts`) already
 * holds a candidate and the PDF text it was extracted from — the runner
 * produced the candidate in its own process and left it on disk, so
 * re-parsing the PDF and re-calling the model to get it back would be
 * absurd. `content` is passed in rather than re-read: it is exactly what
 * the model saw (`candidate.excerpt` is checked against it), and the job
 * file already carries it (`job.request.content`) — the same reasoning
 * `day-producer.ts`'s `writeDayProposals` documents for itself.
 */
export async function writeInvoiceProposal(
	source: InvoiceProposalSource,
	content: string,
	candidate: ProposalCandidate,
	executor?: DbExecutor
): Promise<InvoiceProposalOutcome> {
	// A malformed shape is a job failure, not a quiet rejection: this
	// throws straight out to the caller (`drain.ts`'s outer try/catch),
	// landing the job in `failed/` where a human notices a prompt problem
	// rather than an empty queue with no explanation.
	const extracted = parseExtractedInvoice(candidate.proposedFields);

	const excerptReason = invoiceExcerptRejectionReason(candidate.excerpt, content);
	if (excerptReason) return { proposals: [], rejected: [{ reason: excerptReason }] };

	const result = validateInvoice(extracted);
	if (!result.ok) return { proposals: [], rejected: [{ reason: result.reason }] };

	const proposal = await createProposal(
		{
			documentId: source.documentId,
			contractId: source.contractId,
			targetType: 'invoice',
			// Exactly the fields `applyProposal` reads when a human accepts,
			// and nothing else — the same restraint `day-producer.ts` applies
			// to `proposedFields`.
			proposedFields: result.fields as unknown as Record<string, unknown>,
			excerpt: candidate.excerpt,
			confidence: candidate.confidence,
			confidenceReason: candidate.confidenceReason ?? null
		},
		executor
	);
	return { proposals: [proposal], rejected: [] };
}
