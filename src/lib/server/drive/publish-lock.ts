// The overlap guard `/api/drive/publish/+server.ts` takes before calling
// `publishAllPending`, for the same reason `mail/poll-lock.ts` exists: a
// single in-memory flag, not a database row or an advisory lock, because
// this app runs as one `web` process (no `replicas:` anywhere in
// compose.yaml/compose.prod.yaml) and every request this route ever
// serves lands in that one process and sees this one module-level
// variable.
//
// Why publishing needs the guard at all, when `publishDocument` (#50,
// `publish.ts`) already treats a document's `remoteFileId` as its
// idempotency check: that check-then-write is two separate statements,
// not one atomic operation — `getDocumentMirrorContext` reads
// `remoteFileId`, and only after `target.publish` returns does
// `setDocumentRemoteFileId` write it. Two overlapping ticks of the
// scheduler's drive-publish job (a slow Drive response holding the first
// past the next tick, the same way mail poll's first pass once ran past
// its own next tick) can both read the same pending document with
// `remoteFileId` still null, and both call `target.publish` on it. That
// produces two files at Drive for one document, confirmed reachable on
// #346's own thread: the remote name does not carry `documentId`, so a
// second upload of the same content is indistinguishable from the first
// to `google-drive-target.ts`. Mail poll shipped without this guard once
// and produced 26,627 duplicate documents on a real instance before
// `poll-lock.ts` was written; this route takes the guard from the start
// instead of waiting to measure the Drive-side equivalent.
let publishInFlight = false;

/** Thrown by {@link runExclusiveDriveMirrorPublish} when a publish run is
 * already in progress. The route turns this into
 * `{ status: 'in_flight' }`, never a 500 — a second cron tick losing the
 * race while the first is still uploading is an expected outcome, not a
 * server error. */
export class DriveMirrorAlreadyInFlightError extends Error {
	constructor() {
		super('a drive mirror publish run is already in progress');
		this.name = 'DriveMirrorAlreadyInFlightError';
	}
}

/**
 * Runs `fn` — a call to `publishAllPending` — exclusively. A call that
 * arrives while an earlier one is still pending throws
 * {@link DriveMirrorAlreadyInFlightError} immediately, without ever
 * invoking `fn`, so a second pass over the same pending documents never
 * starts. The flag always clears once `fn` settles, success or failure,
 * so one failed run can never wedge every later one.
 */
export async function runExclusiveDriveMirrorPublish<T>(fn: () => Promise<T>): Promise<T> {
	if (publishInFlight) throw new DriveMirrorAlreadyInFlightError();
	publishInFlight = true;
	try {
		return await fn();
	} finally {
		publishInFlight = false;
	}
}
