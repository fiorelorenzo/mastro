// Packs #214's evidence bundle into one downloadable archive. `fflate` is
// already a dependency (`import/expand.ts` unzips with it); this is the
// one place the app writes a zip rather than reading one.
import { zipSync } from 'fflate';
import type { ContractTemplateLanguage } from '$lib/server/db/schema';
import { renderDisputeBundleSummary } from './summary';
import type { DisputeBundle } from './types';

const MAX_ARCHIVE_ENTRY_NAME_LENGTH = 200;

/**
 * The sink for issue #300 (CWE-22, zip-slip): `zipSync` writes every key in
 * `files` as the entry's path byte for byte and normalises nothing of its
 * own, and `originalName` on a mail-provenance `document` traces back to a
 * value the sender of the polled message once controlled (`mail/poll.ts`).
 * This is deliberately the one place that guarantees the archive's shape,
 * not `poll.ts` at the source — sanitising twice invites the two copies to
 * drift, and a bundle can in principle carry a document any code path
 * archived, not only mail.
 *
 * `/` and `\` (both — the archive is opened on whatever OS the operator
 * runs), `..`/`.`-only segments, empty segments (a leading `/` or `\`, i.e.
 * an absolute-path prefix, produces exactly one), Windows drive letters
 * (`C:`) and control characters are all stripped; what survives is joined
 * back into one flat component, so nothing this returns can ever contain a
 * separator that could address a path outside the directory it is placed
 * under. `fallback` (always a name this process built, never one an
 * attacker supplied) covers the case nothing usable survives.
 */
function sanitizeArchiveEntryName(name: string, fallback: string): string {
	const segments = name
		.split(/[/\\]+/)
		.map((segment) =>
			// eslint-disable-next-line no-control-regex -- deliberately stripping C0/DEL, not matching text.
			segment.replace(/[\x00-\x1f\x7f]/g, '').trim()
		)
		.filter((segment) => segment !== '' && !/^\.+$/.test(segment) && !/^[a-zA-Z]:$/.test(segment));
	const flat = segments.join('-').slice(0, MAX_ARCHIVE_ENTRY_NAME_LENGTH);
	return flat === '' ? fallback : flat;
}

/**
 * `summary.txt` (every field `renderDisputeBundleSummary` writes) plus the
 * archived original itself under `source/<its own file name>` — invariant
 * 4's whole point: a summary of the source document is not the source
 * document, so the export is not the bundle #214 asks for unless the
 * actual bytes are in it. `documentBytes` is `null` exactly when
 * `bundle.document` is (no approval ever archived one) — the zip then
 * carries only the summary, same honesty `SourceDocument.svelte`'s own
 * `null` branch already practises rather than pretending otherwise.
 */
export function renderDisputeBundleZip(
	bundle: DisputeBundle,
	documentBytes: Uint8Array | null,
	language: ContractTemplateLanguage
): Uint8Array {
	const files: Record<string, Uint8Array> = {
		'summary.txt': new TextEncoder().encode(renderDisputeBundleSummary(bundle, language))
	};
	if (bundle.document && documentBytes) {
		const entryName = sanitizeArchiveEntryName(
			bundle.document.originalName,
			`document-${bundle.document.id}`
		);
		files[`source/${entryName}`] = documentBytes;
	}
	return zipSync(files);
}
