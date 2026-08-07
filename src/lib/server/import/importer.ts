// The importer (#41): resolves an adapter for a file from the active
// jurisdiction pack's declared formats, and reports a file no adapter
// claims instead of dropping it silently. Nothing here may name a concrete
// adapter or format id — see `importer.test.ts` for the standing proof,
// mirroring `fiscal/engine.test.ts`.

import type { FiscalPack } from '$lib/server/fiscal/pack';
import type { ImportableFile, InvoiceFormatAdapter } from './adapter';
import type { Invoice } from './invoice';
import type { AdapterRegistry } from './registry';

/**
 * The adapter that claims `file`, or `null` if none does. Only adapters
 * registered under one of `pack.formats` are even tried — an adapter
 * registered for a format the active pack does not declare is never
 * consulted, so a pack with no formats (the generic pack) never resolves
 * one, whatever is registered.
 */
export function resolveAdapter(
	pack: Pick<FiscalPack, 'formats'>,
	registry: AdapterRegistry,
	file: ImportableFile
): InvoiceFormatAdapter | null {
	for (const formatId of pack.formats) {
		const adapter = registry.get(formatId);
		if (adapter && adapter.detect(file)) return adapter;
	}
	return null;
}

export type ImportFileResult =
	| { readonly kind: 'parsed'; readonly adapterId: string; readonly invoices: readonly Invoice[] }
	| { readonly kind: 'unclaimed'; readonly filename: string };

/**
 * Resolves and runs an adapter for `file`. A file no registered adapter
 * (among those the active pack declares) claims comes back as `unclaimed`
 * with the filename that failed to match — never a thrown error, never a
 * value silently dropped by the caller.
 */
export function importFile(
	pack: Pick<FiscalPack, 'formats'>,
	registry: AdapterRegistry,
	file: ImportableFile
): ImportFileResult {
	const adapter = resolveAdapter(pack, registry, file);
	if (!adapter) return { kind: 'unclaimed', filename: file.filename };
	return { kind: 'parsed', adapterId: adapter.id, invoices: adapter.parse(file) };
}
