// The one-way publish contract for a document mirror (#50, epic #7's "the
// cloud drive is a one-way mirror, never a source"). `MirrorTarget` has
// exactly one method, and it only ever writes: there is no `read`, `get`
// or `list` here, and none should ever be added. That is deliberate and
// is the acceptance criterion "nothing is ever read back from the drive
// into the system" enforced in the type itself — a caller that only ever
// sees this interface has no way to ask a target for content back, so a
// future bug that tries to treat the drive as a source fails to compile
// rather than silently working. See `google-drive-target.ts` and
// `local-target.ts` for the two real implementations, and `publish.ts`
// for the orchestration that calls `publish` and records the outcome.

/** Where in the target's own folder structure a document belongs, root
 * first — `{ segments: ['Contracts', 'Acme SRL'] }` publishes into
 * `/Contracts/Acme SRL/` (or the target's equivalent of a path). Resolved
 * by the caller (`folder.ts`), never by a `MirrorTarget` itself: a target
 * only knows how to create and write into a path, not what the path
 * should be for a given document, which is a domain decision that has
 * nothing to do with which cloud provider is on the other end. */
export type MirrorFolder = {
	readonly segments: readonly string[];
};

export type MirrorPublishInput = {
	/** The `document.id` this publish is for — used only to build a
	 * collision-free remote name (see `local-target.ts`); never sent
	 * anywhere as a lookup key, since nothing is ever read back. */
	readonly documentId: string;
	readonly bytes: Uint8Array;
	readonly mime: string;
	/** The name the file should carry at the target, e.g.
	 * `document.originalName`. */
	readonly fileName: string;
	readonly folder: MirrorFolder;
};

export type MirrorPublishResult = {
	/** The id `publishDocument` records on `document.remoteFileId`. Opaque
	 * to mastro: a Drive file id for `GoogleDriveMirrorTarget`, a relative
	 * path for `LocalDirectoryMirrorTarget`. Never parsed or interpreted,
	 * only stored and shown back to a human. */
	readonly remoteFileId: string;
};

/**
 * Implemented by every mirror destination. `publish` creates whatever
 * folder structure `input.folder` names (creating it if it does not
 * exist yet) and writes `input.bytes` into it, returning the id the
 * target now knows this copy by. It never overwrites in place — a second
 * `publish` call for the same document is `publishDocument`'s job to
 * avoid (it no-ops once `document.remoteFileId` is set), not this
 * interface's.
 */
export interface MirrorTarget {
	publish(input: MirrorPublishInput): Promise<MirrorPublishResult>;
}
