/**
 * The pure half of `DropZone.svelte`: matching a dropped `File` against an
 * `accept` list, merging a drop into whatever is already chosen, and
 * removing one chosen file — split out so it is unit-testable without a
 * component renderer, following `button-classes.ts`/`badge-variants.ts`.
 *
 * This module exists because of one fact worth restating: the browser's
 * native file picker enforces `accept` on your behalf, but drag-and-drop
 * has no such hook — a `dragover`/`drop` handler receives whatever the OS
 * handed it, of any type, and it is this module's job to say no to the
 * wrong ones instead of quietly waving them through (docs/specs/
 * 2026-08-14-client-intake-design.md, "the part that actually needs
 * care").
 */

/** One clause of an `accept` attribute, normalised to lower case. */
export type AcceptRule =
	| { readonly kind: 'extension'; readonly value: string } // ".pdf"
	| { readonly kind: 'mime'; readonly value: string } // "application/pdf"
	| { readonly kind: 'mime-wildcard'; readonly value: string }; // "image" (from "image/*")

/**
 * Splits a raw `accept` attribute (`".pdf,application/pdf"`,
 * `"image/*"`) into its individual clauses. An absent or blank `accept`
 * parses to no rules at all, which `fileMatchesAccept` treats as
 * "anything goes" — the same meaning the attribute has natively.
 */
export function parseAccept(accept: string | null | undefined): readonly AcceptRule[] {
	if (!accept) return [];
	return accept
		.split(',')
		.map((token) => token.trim().toLowerCase())
		.filter((token) => token.length > 0)
		.map((token): AcceptRule => {
			if (token.startsWith('.')) return { kind: 'extension', value: token };
			if (token.endsWith('/*')) return { kind: 'mime-wildcard', value: token.slice(0, -2) };
			return { kind: 'mime', value: token };
		});
}

/** Whether `file` satisfies at least one clause of `rules` — an empty rule
 *  set (no `accept` was given) always matches, same as the native attribute. */
export function fileMatchesAccept(
	file: { readonly name: string; readonly type: string },
	rules: readonly AcceptRule[]
): boolean {
	if (rules.length === 0) return true;
	const name = file.name.toLowerCase();
	const type = file.type.toLowerCase();
	return rules.some((rule) => {
		if (rule.kind === 'extension') return name.endsWith(rule.value);
		if (rule.kind === 'mime-wildcard') return type.startsWith(`${rule.value}/`);
		return type === rule.value;
	});
}

export interface AcceptPartition {
	readonly accepted: readonly File[];
	readonly rejected: readonly File[];
}

/** Splits a drop into what `accept` allows and what it refuses. The one
 *  function that stands between a wrong-typed drop and the input. */
export function partitionByAccept(
	files: readonly File[],
	accept: string | null | undefined
): AcceptPartition {
	const rules = parseAccept(accept);
	const accepted: File[] = [];
	const rejected: File[] = [];
	for (const file of files) {
		(fileMatchesAccept(file, rules) ? accepted : rejected).push(file);
	}
	return { accepted, rejected };
}

/** The human-readable form of `accept`, for the message naming what was
 *  expected — `".pdf, application/pdf"`, verbatim clauses, comma-joined. */
export function acceptSummary(accept: string | null | undefined): string {
	return parseAccept(accept)
		.map((rule) => (rule.kind === 'mime-wildcard' ? `${rule.value}/*` : rule.value))
		.join(', ');
}

/**
 * Merges a drop's already-accepted files into whatever is chosen today.
 * A single-file zone (`multiple` false) behaves like the native input
 * always has: the drop replaces the selection outright, keeping only the
 * first dropped file. A multi-file zone appends, skipping anything that
 * is (by name, size and last-modified time) already in the selection —
 * dropping the same file twice must not list it twice.
 */
export function mergeSelection(
	existing: readonly File[],
	incoming: readonly File[],
	multiple: boolean
): File[] {
	if (incoming.length === 0) return [...existing];
	if (!multiple) return [incoming[0]];
	const merged = [...existing];
	for (const file of incoming) {
		const alreadyChosen = merged.some(
			(chosen) =>
				chosen.name === file.name &&
				chosen.size === file.size &&
				chosen.lastModified === file.lastModified
		);
		if (!alreadyChosen) merged.push(file);
	}
	return merged;
}

/** `files` with the entry at `index` removed — what the chosen-file list's
 *  remove button computes before writing the result back onto the input. */
export function removeFileAt(files: readonly File[], index: number): File[] {
	return files.filter((_, i) => i !== index);
}
