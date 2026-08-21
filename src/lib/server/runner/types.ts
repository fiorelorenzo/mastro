// #82: the shapes that cross the boundary between the SvelteKit app (full
// database privileges) and the ACP runner (a separate process, a
// read-only database role, no filesystem access to the blob store). A
// producer (#85/#86/#87, none of which exist yet) builds an
// `ExtractionRequest` from a document it has already read and archived,
// and gets back an `ExtractionResult` it can pass straight into
// `createProposal` (`repositories/proposal.ts`) — this module never calls
// that itself, since it has no write access to do so.

export interface ExtractionRequest {
	/** The document the extraction reads. The runner re-derives this
	 * document's `contractId` from its own scoped database read and
	 * rejects the job if it disagrees with `contractId` below — a
	 * defence-in-depth check against a producer bug naming the wrong
	 * contract. */
	documentId: string;
	/** The contract `content` is being extracted on behalf of. The runner
	 * re-derives it from `documentId` and rejects a job whose claim
	 * disagrees, which is the one check it still makes for itself. Null
	 * for a first-intake contract PDF (#86): the document it was archived
	 * against has no contract yet either, and the runner's check becomes
	 * "both sides agree there is none" rather than "both sides name the
	 * same one". */
	contractId: string | null;
	/** What kind of proposal this becomes once accepted — passed straight
	 * through to `proposal.targetType` by whichever producer calls this;
	 * the runner does not interpret it. */
	targetType: string;
	/** The material to hand to the model: an email body, PDF text already
	 * extracted by the caller. The runner never reads the blob store
	 * itself (#82's read grant does not cover it) — whoever builds this
	 * request already read the archived original with its own, fully
	 * privileged database connection. */
	content: string;
	/** Task-specific instructions for the model — including what shape of
	 * JSON to answer with — supplied by the producer. #82 builds the
	 * substrate every producer shares; it hardcodes no extraction prompt
	 * of its own. */
	instructions: string;
	/**
	 * The conversation behind `content`, oldest first (#400).
	 *
	 * The index into this array is the `messageIndex` a proposed day answers
	 * with, which is how a conversation-level extraction still produces
	 * proposals that each point at one archived message. Optional, and that
	 * is not laziness: a contract PDF and an invoice are genuinely one
	 * document, and a one-element array for them would be a shape claiming a
	 * conversation exists where none does.
	 *
	 * The runner passes this through untouched, exactly as it does `content`
	 * and `instructions`. It has no read access to any of these documents
	 * beyond the anchor, and does not try to.
	 */
	conversation?: readonly {
		readonly documentId: string;
		readonly sentAt: string;
		readonly from: string;
		readonly body: string;
	}[];
}

/** What a model call is expected to answer with once its response text is
 * parsed as JSON — the minimum shape `ProposalInput` (#83) needs from a
 * producer. `job.ts` validates a model's raw text against exactly this
 * before returning it; anything else is a loud parse error, never a
 * best-effort guess. */
export interface ExtractionResult {
	proposedFields: Record<string, unknown>;
	excerpt: string;
	confidence: number;
	/** The model's own short reason for a lowered confidence (#244) —
	 * present when it had something to explain, absent when confidence is
	 * high. Carried straight through to `proposal.confidenceReason`, and
	 * folded together with the year-rollover guard's own reason by
	 * `day-extraction.ts`'s `dayConfidence` when both apply. */
	confidenceReason?: string;
}

/** `ExtractionResult` plus the identifying fields `ProposalInput` also
 * needs — everything a future producer passes straight into
 * `createProposal` after a human never touches this shape in between. */
export type ProposalCandidate = ExtractionResult & {
	documentId: string;
	contractId: string | null;
	targetType: string;
};

/** One line of `runs/<jobId>.jsonl` (#277) — the runner's only channel for
 * reporting what the agent is doing, since it has no database write
 * access to record an `extraction_run_event` itself. The stream reader
 * in the web app is the sole consumer: it tails the file, persists each
 * line as a row and deletes the file once the job is drained, so this
 * type is a transport shape, never the record of truth. `kind` mirrors
 * `extraction_run_event.kind` exactly, because a line becomes a row
 * unchanged. */
export interface RunProgressLine {
	seq: number;
	/** ISO 8601, the runner's own clock when it observed the update. */
	at: string;
	kind: 'message' | 'thought' | 'tool_call' | 'plan' | 'stop' | 'error';
	payload: string;
}
