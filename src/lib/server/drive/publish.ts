// Orchestrates one document's publish to a `MirrorTarget` (#50): resolve
// where it belongs, read its bytes, hand them to the target, and record
// what happened either way. No route or worker calls this yet — the
// architecture (AGENTS.md) puts mirror publishing on "a separate worker
// process" that does not exist on `main` yet, the same reason
// `mail/send.ts`'s `composeForAutomaticTrigger` has no scheduler calling
// it either. This is what that worker will call, one document at a time
// (`publishDocument`) or as a batch of everything still pending
// (`publishAllPending`).
import { db, type DbExecutor } from '$lib/server/db';
import { readDocumentBytes, setDocumentRemoteFileId } from '$lib/server/repositories/document';
import {
	getDocumentMirrorContext,
	listUnmirroredDocuments,
	recordMirrorRun
} from '$lib/server/repositories/document-mirror';
import type { MirrorFolderConfig } from './folder';
import { resolveMirrorFolder } from './folder';
import type { MirrorTarget } from './mirror-target';

export type PublishOutcome =
	| { readonly ok: true; readonly remoteFileId: string }
	| { readonly ok: false; readonly detail: string };

/**
 * Publishes one document. Idempotent: a document that already carries a
 * `remoteFileId` is returned as-is without touching `target` again or
 * writing a new `document_mirror_run` row, so calling this twice for the
 * same document — a retried batch, an overlapping scheduler run — never
 * produces two copies at the target.
 *
 * A `target.publish` failure is caught here, never rethrown: it is
 * recorded as a `failure` row (`recordMirrorRun`) and returned as
 * `{ ok: false }`, which is the acceptance criterion "a failed publish is
 * visible rather than silent" — visible in the table #74's alert engine
 * is meant to query, not as an unhandled rejection that crashes whatever
 * called this.
 */
export async function publishDocument(
	documentId: string,
	target: MirrorTarget,
	folderConfig: MirrorFolderConfig,
	executor: DbExecutor = db
): Promise<PublishOutcome> {
	const context = await getDocumentMirrorContext(documentId, executor);
	if (!context) throw new Error(`document ${documentId} not found`);

	if (context.document.remoteFileId) {
		return { ok: true, remoteFileId: context.document.remoteFileId };
	}

	const folder = resolveMirrorFolder({ clientLegalName: context.clientLegalName }, folderConfig);
	const bytes = await readDocumentBytes(context.document);

	try {
		const result = await target.publish({
			documentId: context.document.id,
			bytes,
			mime: context.document.mime,
			fileName: context.document.originalName,
			folder
		});
		await setDocumentRemoteFileId(context.document.id, result.remoteFileId, executor);
		await recordMirrorRun(
			{ documentId: context.document.id, status: 'success', detail: null },
			executor
		);
		return { ok: true, remoteFileId: result.remoteFileId };
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		await recordMirrorRun({ documentId: context.document.id, status: 'failure', detail }, executor);
		return { ok: false, detail };
	}
}

/** Publishes every document not yet mirrored. One document's failure
 * (already turned into a `failure` run row by `publishDocument`) never
 * stops the rest — a self-hoster whose Drive quota is briefly exhausted
 * on one file should not also lose every other pending publish in the
 * same run. */
export async function publishAllPending(
	target: MirrorTarget,
	folderConfig: MirrorFolderConfig,
	executor: DbExecutor = db
): Promise<PublishOutcome[]> {
	const pending = await listUnmirroredDocuments(executor);
	const outcomes: PublishOutcome[] = [];
	for (const row of pending) {
		try {
			outcomes.push(await publishDocument(row.id, target, folderConfig, executor));
		} catch (error) {
			// One document nobody can read must not stop the mirror for every
			// other one — the same "one bad row does not stop the batch" shape
			// the alert engine and the ACP runner already use. A blob missing
			// from disk is not hypothetical: a database restored without its
			// documents directory is exactly this, and the alert engine's
			// mirror-failure query is what should surface it.
			outcomes.push({
				ok: false,
				detail: error instanceof Error ? error.message : String(error)
			});
		}
	}
	return outcomes;
}
