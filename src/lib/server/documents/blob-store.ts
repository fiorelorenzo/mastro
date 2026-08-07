// Content-addressed storage on disk (#49). This module knows nothing about
// Postgres or SvelteKit: it takes a root directory explicitly rather than
// reading configuration itself, so it is exercised directly against a
// throwaway temp directory in tests instead of a real storage root.
//
// `src/lib/server/repositories/document.ts` is the actual entry point
// application code calls: it resolves the configured root, calls
// `writeBlob` here, and records the metadata row in Postgres.
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** The sha256 of `bytes`, lowercase hex. Pure; this is the value stored as
 * `document.hash` and used to derive the on-disk path. */
export function hashContent(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

/** Where the blob for `hash` lives under `root`. Two-level sharding
 * (`ab/cd/abcd...`) keeps any one directory from accumulating one entry per
 * document ever ingested. */
export function blobPath(root: string, hash: string): string {
	return join(root, hash.slice(0, 2), hash.slice(2, 4), hash);
}

/** Owner-only: these blobs are the evidentiary documents invariant 4
 * exists to protect (signed contracts, approval emails, imported
 * invoices) — never group- or world-readable, regardless of the
 * process umask. Passed explicitly to `mkdir`/`writeFile` rather than
 * relied on implicitly: the kernel ANDs a requested mode with
 * `~umask`, so umask can only ever narrow these further, never widen
 * them past what is requested here (#114). */
const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

/**
 * Writes `bytes` to content-addressed storage under `root`, returning the
 * hash and size. If a blob for this hash already exists, it is left
 * untouched and no write happens: this is the "one copy" half of #49's
 * "the same file uploaded twice stores one copy and two references" —
 * the "two references" half is two `document` rows in Postgres, one per
 * call, both naming the same hash (see `storeDocument`).
 *
 * A blob already on disk from before #114 landed, written under a looser
 * umask, is left exactly as it was found — this function only ever
 * chooses the mode for bytes it writes itself, never retroactively
 * tightens a file it did not create this call. A self-hoster upgrading
 * onto this version with an existing `DOCUMENTS_DIR` should retighten it
 * once by hand; the exact command is in `docs/security.md`.
 */
export async function writeBlob(
	root: string,
	bytes: Uint8Array
): Promise<{ hash: string; size: number }> {
	const hash = hashContent(bytes);
	const path = blobPath(root, hash);

	const alreadyStored = await stat(path)
		.then(() => true)
		.catch(() => false);

	if (!alreadyStored) {
		await mkdir(dirname(path), { recursive: true, mode: DIR_MODE });
		// Write to a temp file first and rename into place: a concurrent
		// second upload of the same content that loses the mkdir/write race
		// still ends up with one complete file, never a half-written one.
		// `rename` carries the temp file's own mode across, so the mode
		// only needs setting once, at creation.
		const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
		await writeFile(tmpPath, bytes, { mode: FILE_MODE });
		await rename(tmpPath, path);
	}

	return { hash, size: bytes.byteLength };
}

/** Reads the blob for `hash` back out. Throws if it was never written. */
export async function readBlob(root: string, hash: string): Promise<Buffer> {
	return readFile(blobPath(root, hash));
}
