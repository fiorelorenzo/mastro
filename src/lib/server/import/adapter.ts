// The adapter interface (#41). This file, `invoice.ts` and `importer.ts`
// are the engine — see `importer.test.ts` for the standing proof that none
// of them names a concrete format. Adding a format is adding a file under
// `formats/` plus one line in `registry.ts`, per AGENTS.md invariant 1's
// reasoning applied to import instead of fiscal rules.

import type { Invoice } from './invoice';

/**
 * A file handed to the import pipeline: its bytes and the name the
 * filesystem (or an archive entry, or an unwrapped signed envelope) gave
 * it. `filename` is for diagnostics and dedup (#44) only — an adapter must
 * never use it to decide whether it claims the file. Trusting an extension
 * is how a renamed PDF ends up "detected" as an XML invoice.
 */
export interface ImportableFile {
	readonly filename: string;
	readonly content: Uint8Array;
}

/**
 * A single structured invoice format. `id` is a registry lookup key that
 * matches an entry in a jurisdiction pack's `formats` list
 * (`fiscal/pack.ts`) — the importer resolves an adapter only for a format
 * the active pack actually declares support for, so selecting the generic
 * pack (which declares none) selects no adapter, per invariant 1.
 */
export interface InvoiceFormatAdapter {
	readonly id: string;

	/**
	 * Whether `file` is this adapter's format. Must be cheap and total: an
	 * unrelated PDF, a zip, or outright garbage bytes must make `detect`
	 * return `false`, never throw. The importer relies on that to try every
	 * candidate adapter in turn.
	 */
	detect(file: ImportableFile): boolean;

	/**
	 * Parses `file` into the neutral `Invoice` shape. Only ever called
	 * after `detect` returned `true` for the same file; a document that
	 * passes `detect` but turns out malformed should throw rather than
	 * return a partial or guessed `Invoice` — there is no human in this
	 * path to notice a wrong field.
	 */
	parse(file: ImportableFile): Invoice;
}
