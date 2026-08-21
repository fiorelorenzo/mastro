// The server-side half of #343's bound on the "poll now" button: a poll
// opens one IMAP connection per configured folder, so a button pressable
// from two browser tabs at once — or the same tab, twice, before the
// first request even returns — is a way to open two overlapping
// connection sets against one account and get it rate-limited by the
// provider. Disabling the button while a submit is in flight
// (`submitting()`, `+page.svelte`) is a courtesy for the tab that pressed
// it; it says nothing about a second tab, or a second browser, or the
// same tab reloaded mid-request.
//
// A single in-memory flag, not a database row or an advisory lock: this
// app runs as one `web` process — no `replicas:` in compose.yaml or
// compose.prod.yaml, and nothing else in this codebase assumes more than
// one — so every request `pollNow` ever serves, from any tab, any
// browser, any signed-in session, lands in this one process and sees this
// one module-level variable. A row or an advisory lock would buy nothing
// this flag does not already have and would outlive a poll that this
// process no longer remembers starting after a restart, which is exactly
// the state a lock must never be left in.
import { finishPollProgress, startPollProgress } from './poll-progress';

let pollInFlight = false;

/** Thrown by {@link runExclusiveMailPoll} when a poll is already running.
 * `+page.server.ts`'s `pollNow` action turns this into `fail(409, ...)`,
 * never a 500 — a second press losing the race is an expected outcome,
 * not a server error. */
export class MailPollAlreadyInFlightError extends Error {
	constructor() {
		super('a mailbox poll is already in progress');
		this.name = 'MailPollAlreadyInFlightError';
	}
}

/**
 * Runs `fn` — a call to `pollMailboxesOnce` — exclusively. A call that
 * arrives while an earlier one is still pending throws
 * {@link MailPollAlreadyInFlightError} immediately, without ever invoking
 * `fn`, so a second connection set is never opened. The flag always
 * clears once `fn` settles, success or failure, so one failed poll can
 * never wedge every later one.
 */
export async function runExclusiveMailPoll<T>(fn: () => Promise<T>): Promise<T> {
	if (pollInFlight) throw new MailPollAlreadyInFlightError();
	pollInFlight = true;
	// The progress log starts here rather than in either caller (#405), so
	// neither can forget it and a second press that loses the race above
	// cannot wipe the log of the poll it lost to — it throws before this
	// line. The terminal phase is reported by `pollMailboxesOnce`, which is
	// the only thing that knows whether a pass succeeded (a connection
	// failure is a returned status there, not a thrown error); the `finally`
	// below is the net for `fn` throwing outright, which would otherwise
	// leave a log that stops mid-phase and reads as a poll still running.
	startPollProgress();
	try {
		return await fn();
	} finally {
		pollInFlight = false;
		finishPollProgress('failed');
	}
}
