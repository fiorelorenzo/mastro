// Packs #214's evidence bundle into one downloadable archive. `fflate` is
// already a dependency (`import/expand.ts` unzips with it); this is the
// one place the app writes a zip rather than reading one.
import { zipSync } from 'fflate';
import type { ContractTemplateLanguage } from '$lib/server/db/schema';
import { renderDisputeBundleSummary } from './summary';
import type { DisputeBundle } from './types';

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
		files[`source/${bundle.document.originalName}`] = documentBytes;
	}
	return zipSync(files);
}
