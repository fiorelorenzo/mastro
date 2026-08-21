import type { PollPhase, PollProgress, PollProgressStep } from '$lib/mail/poll-phase';

// What a poll is doing while it is doing it (#405). The button used to be
// a full-page form submit: press it, the browser navigates, and the page
// (button included) is replaced by a spinner for as long as the mailbox
// takes — which on a first pass over a real account is tens of seconds
// with nothing on screen to say whether anything is happening.
//
// A poll's phases are not evenly sized and the slow one is not the one a
// reader would guess: re-attribution and the cursor lookup are single
// queries, the listing walks every UID above the cursor, and the second
// fetch pulls the bodies of only what the listing decided to keep. So the
// useful thing to show is not a percentage — nothing here knows the
// denominator before the listing ends — but the phases themselves, with
// the counts they settle on.
//
// Module-level, exactly like the in-flight flag next door
// (`poll-lock.ts`, whose comment explains why one process is a safe
// assumption here): every request lands in this process, so the GET that
// reads this is looking at the same array the poll is appending to. It is
// deliberately not a database table. Progress is worth watching for the
// seconds it takes and worth nothing afterwards; the durable record of a
// poll is `mailbox_poll_run`, which is what the status strip reads.
//
// Steps are structured, never prose (#286): the label a reader sees comes
// from the i18n catalogues client-side. A server that formats English
// into a log line is a server that has left the i18n layer.

// The longest phase list a poll can produce is fixed and short (one per
// phase above, plus one `archived` per message batch), but a caller could
// in principle report per-message. Bounded so a pathological poll cannot
// grow this without limit in a long-lived process.
const MAX_STEPS = 64;

let sequence = 0;
let running = false;
let steps: PollProgressStep[] = [];

/** Starts a fresh log. Called by whoever owns the poll, before the first
 * phase — `runExclusiveMailPoll`'s caller, so a poll that never starts
 * because one is already in flight does not wipe the running one's log. */
export function startPollProgress(): void {
	sequence += 1;
	running = true;
	steps = [];
}

/** Appends a phase. A no-op when no poll is running, so a stray report
 * from a poll whose log has already been closed cannot resurrect it. */
export function reportPollPhase(phase: PollPhase, count?: number, of?: number): void {
	if (!running) return;
	if (steps.length >= MAX_STEPS) return;
	steps = [...steps, { phase, count, of, at: new Date().toISOString() }];
}

/** Closes the log, keeping it readable. `phase` is the terminal one, so a
 * failure reads as a failure rather than as a poll that stopped talking. */
export function finishPollProgress(phase: 'done' | 'failed', count?: number): void {
	if (!running) return;
	reportPollPhase(phase, count);
	running = false;
}

export function readPollProgress(): PollProgress {
	return { running, sequence, steps };
}
