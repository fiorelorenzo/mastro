// A `MirrorTarget` (#50) that publishes into a directory on disk instead
// of a cloud provider. Two reasons this exists, both from the issue
// itself: it is what proves `MirrorTarget`'s shape is actually
// implementable by more than one thing, and it gives the test suite an
// honest target to publish into and read back from directly, since
// nothing here can call the real Google Drive API without live
// credentials this project does not have. It is also genuinely useful on
// its own — a self-hoster who mirrors a synced folder (Syncthing,
// rclone, a mounted cloud-drive filesystem) into place needs nothing
// from Google to get an off-instance copy of every document.
//
// Deliberately independent of `blob-store.ts`: that module is
// content-addressed storage for the archive of record (the source of
// truth), this is a disposable copy for a human to browse — same
// `bytes`, different job, and conflating the two would make the mirror
// no longer just a mirror.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MirrorPublishInput, MirrorPublishResult, MirrorTarget } from './mirror-target';

/**
 * `rootDir` is where the folder structure `input.folder` names is
 * created, mirroring `blob-store.ts`'s own explicit-root convention so
 * this is exercised directly against a throwaway temp directory in
 * tests. Every published file is named `<documentId>__<fileName>`: two
 * different documents can legitimately share a folder and an original
 * file name (two "contract.pdf" for the same client, say), and unlike
 * Drive's own storage — which tracks files by an opaque id regardless of
 * name — a plain directory cannot hold two files with the same path, so
 * the id is folded into the name to keep every publish collision-free.
 */
export function createLocalDirectoryMirrorTarget(rootDir: string): MirrorTarget {
	return {
		async publish(input: MirrorPublishInput): Promise<MirrorPublishResult> {
			const dir = join(rootDir, ...input.folder.segments);
			await mkdir(dir, { recursive: true });
			const fileName = `${input.documentId}__${input.fileName}`;
			await writeFile(join(dir, fileName), input.bytes);
			// A relative path, not an absolute one: portable across a
			// restore onto a different root, and enough for a human to
			// locate the file without mastro ever reading it back itself.
			return { remoteFileId: join(...input.folder.segments, fileName) };
		}
	};
}
