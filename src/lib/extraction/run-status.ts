/**
 * The statuses an extraction run passes through, and the one canonical list
 * of them.
 *
 * Outside `$lib/server` for the same reason `failure-kind.ts` is: the
 * registry and the run page both render a status, so the vocabulary cannot
 * live behind the server boundary. The `extraction_run.status` column
 * declares `$type<ExtractionRunStatus>()` against this, and the badge and
 * label maps in `routes/import/runs/run-status.ts` are
 * `Record<ExtractionRunStatus, ...>` over it, so a status added here fails
 * the build in every place that has to say something about it.
 *
 * That last part is the reason this file exists at all (#398). There used to
 * be two lists - this union in the schema and a hand-written `as const`
 * array in the route - with nothing tying them together. Adding a sixth
 * status to the schema compiled cleanly while the registry's exhaustive
 * `Record`s stayed blind to it, which is precisely the drift an exhaustive
 * `Record` is supposed to prevent.
 */
export const extractionRunStatuses = [
	'queued',
	'running',
	'extracted',
	'applied',
	/**
	 * Read successfully, and there was nothing in it to propose (#398).
	 *
	 * A status of its own rather than a reinterpretation of `applied`,
	 * because `extraction_run_proposal_id_iff_applied` ties that one to a
	 * real proposal and should: an applied run produced something. Before
	 * this existed the drain threw on a no-proposal outcome, so the run
	 * landed on `failed` claiming the model broke when the truth was that a
	 * newsletter approved no days - and said it again on every sweep
	 * forever, since a failed job is deliberately left in `done/` for a
	 * retry (#278).
	 */
	'nothing_proposed',
	'failed'
] as const;

export type ExtractionRunStatus = (typeof extractionRunStatuses)[number];

/**
 * A run reaches exactly one of these and never leaves it - the registry's
 * own "is this row still moving" check, and what closes the SSE connection
 * on the run page (design doc: "Close the source on a terminal status").
 */
export function isTerminalRunStatus(status: ExtractionRunStatus): boolean {
	return status === 'applied' || status === 'failed' || status === 'nothing_proposed';
}
