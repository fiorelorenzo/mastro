/**
 * The phases one mailbox poll passes through, and the shape they travel in
 * (#405).
 *
 * Outside `$lib/server` for the same reason `$lib/extraction/run-status.ts`
 * is: the poller writes these and the mail page renders them, so the
 * vocabulary cannot live behind the server boundary — a component importing
 * `$lib/server/...`, even for a type, is an illegal import in SvelteKit and
 * a duplicated union is how the two halves drift apart.
 *
 * A phase carries counts, never prose. The sentence a reader sees is built
 * client-side from the i18n catalogues (#286), which is also the only way
 * it can be in the reader's language rather than the server's.
 */
export const POLL_PHASES = [
	'connecting',
	'reattributing',
	'mailbox_opened',
	'listing',
	'fetching',
	'archived',
	'done',
	'failed'
] as const;

export type PollPhase = (typeof POLL_PHASES)[number];

export interface PollProgressStep {
	readonly phase: PollPhase;
	/** The count the phase settled on — messages seen, kept, archived.
	 * Absent for a phase with nothing to count, like `connecting`. */
	readonly count?: number;
	/** A second figure where one number cannot carry the phase: `listing`
	 * reports how many it kept out of how many it saw. */
	readonly of?: number;
	readonly at: string;
}

export interface PollProgress {
	/** Whether the poll these steps belong to is still running. A finished
	 * log stays readable, so the last thing a reader saw does not vanish
	 * the moment the poll ends. */
	readonly running: boolean;
	/** Bumped once per poll, so a client can tell "the same poll, one step
	 * further" from "a different poll started since I last looked" without
	 * comparing arrays. */
	readonly sequence: number;
	readonly steps: readonly PollProgressStep[];
}
