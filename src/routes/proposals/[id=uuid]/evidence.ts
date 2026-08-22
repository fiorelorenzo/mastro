/**
 * Pure helpers for the proposal review screen's evidence panel: splitting
 * the archived message's decoded body around the proposal's own excerpt
 * so the matched sentence can be marked (#243), and judging whether a
 * given proposed field's value is actually traceable to that excerpt's
 * text — the signal behind each field's "what the model read it from"
 * hint.
 */

export type ExcerptSplit = { before: string; match: string; after: string };

/**
 * Locates `excerpt` inside `body` case-insensitively (the excerpt is the
 * producer's own verbatim span, but whitespace/case can still drift
 * across the decode) and returns the three pieces around it, preserving
 * `body`'s own original casing in `match`. `null` when the excerpt
 * cannot be found at all — a decoding mismatch, or a body that changed
 * since the proposal was created — so the caller can fall back to
 * showing the whole message unmarked rather than mis-highlighting.
 */
export function splitOnExcerpt(body: string, excerpt: string): ExcerptSplit | null {
	const trimmed = excerpt.trim();
	if (!trimmed) return null;
	const index = body.toLowerCase().indexOf(trimmed.toLowerCase());
	if (index === -1) return null;
	return {
		before: body.slice(0, index),
		match: body.slice(index, index + trimmed.length),
		after: body.slice(index + trimmed.length)
	};
}

/**
 * Whether `value` reads as grounded in `excerpt`'s own text — the
 * per-field counterpart of what `splitOnExcerpt` marks for the whole
 * message. A date is grounded when its day-of-month appears in the
 * excerpt; a whole-number quantity when it appears as a standalone
 * token; a fractional quantity (the one fraction this domain's rate
 * cards actually allow, a half day) when the excerpt uses the Italian
 * half-day wording ("mezza"/"mezzo") rather than a bare "0.5" nobody
 * writes in prose; any other non-empty string when it appears verbatim.
 * Anything else — most often `scope`, which the day-extraction prompt
 * never asks the model to read off the message at all — reads as not
 * grounded: inherited from the contract or another default, not the
 * archived text sitting next to it.
 *
 * This is a display heuristic, not a source of truth: it never blocks an
 * accept, it only decides which of two honest hints a field shows.
 */
export function isFieldGroundedInExcerpt(value: unknown, excerpt: string): boolean {
	const haystack = excerpt.toLowerCase();
	if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
		const dayOfMonth = String(Number(value.slice(8, 10)));
		return new RegExp(`\\b${dayOfMonth}\\b`).test(haystack);
	}
	if (typeof value === 'number') {
		if (!Number.isInteger(value)) return /mezz[oa]/i.test(haystack);
		return new RegExp(`\\b${value}\\b`).test(haystack);
	}
	if (typeof value === 'string' && value.trim().length > 0) {
		return haystack.includes(value.trim().toLowerCase());
	}
	return false;
}
