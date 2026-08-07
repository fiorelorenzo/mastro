// #82: the shapes that cross the boundary between the SvelteKit app (full
// database privileges) and the ACP runner (a separate process, a
// read-only database role, no filesystem access to the blob store). A
// producer (#85/#86/#87, none of which exist yet) builds an
// `ExtractionRequest` from a document it has already read and archived,
// and gets back an `ExtractionResult` it can pass straight into
// `createProposal` (`repositories/proposal.ts`) — this module never calls
// that itself, since it has no write access to do so.

export type ExtractionProvider = 'local' | 'hosted';

export interface ExtractionRequest {
	/** The document the extraction reads. The runner re-derives this
	 * document's `contractId` from its own scoped database read and
	 * rejects the job if it disagrees with `contractId` below — a
	 * defense-in-depth check against a producer bug routing a document to
	 * the wrong contract's consent decision. */
	documentId: string;
	/** The contract `content` is being extracted on behalf of. Routing
	 * (`routing.ts`) reads this contract's
	 * `hosted_extraction_consent_document_id`, never `documentId`'s. */
	contractId: string;
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
	/** Omitted or `'local'`: the default, always allowed. `'hosted'`:
	 * refused outright (`HostedExtractionRefused`) unless `contractId`'s
	 * `hosted_extraction_consent_document_id` is set. */
	requestedProvider?: ExtractionProvider;
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
}

/** `ExtractionResult` plus the identifying fields `ProposalInput` also
 * needs — everything a future producer passes straight into
 * `createProposal` after a human never touches this shape in between. */
export type ProposalCandidate = ExtractionResult & {
	documentId: string;
	contractId: string;
	targetType: string;
};
