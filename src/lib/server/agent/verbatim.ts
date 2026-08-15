/**
 * Checking that a quotation really is in the document it claims to quote
 * (#279), for evidence that legitimately sits in more than one place.
 *
 * A contract's own identification is the parties, at the top of page one,
 * and the date, in the signature block on page eight. An ambiguity worth
 * flagging is frequently two clauses that disagree, and they are not
 * adjacent either. Asking the model for "the verbatim span" was asking
 * for something that often does not exist, so it did the sensible thing
 * and joined two spans — and the check refused the result, correctly,
 * because that joined string appears nowhere in the document.
 *
 * The answer is not to loosen the check. It is to let a quotation be more
 * than one span, and to check every one of them:
 *
 *     "Tra Ortofrutta Bassano S.r.l. [...] Bassano, 12 agosto 2026"
 *
 * Both sides must be in the document, so the evidence is still evidence.
 * The elision marker survives into storage exactly as the model wrote it
 * — it is the scholarly convention for a gap, it reads correctly in the
 * blockquote a reviewer sees, and rewriting somebody's quotation to look
 * tidier is the last thing an evidence trail should do.
 */

/** `[...]` or `[…]`, with or without inner spaces — how a model writes a gap. */
const ELISION = /\[\s*(?:\.\s*\.\s*\.|…)\s*\]/;

/**
 * Whitespace is not evidence: a PDF extractor's line wrapping differs
 * from the model's, and neither says anything about what the document
 * means.
 */
export function normaliseForComparison(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}

/** The spans a quotation rests on — one, unless it elides. */
export function verbatimSpans(quotation: string): string[] {
	return quotation
		.split(ELISION)
		.map((span) => span.trim())
		.filter((span) => span !== '');
}

export type VerbatimCheck = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * Every span of `quotation` must appear in `content`, and when there is
 * more than one, each must be substantial on its own.
 *
 * That floor is the whole reason multi-span quoting stays honest. Any
 * three-letter fragment appears in any document, so without it a
 * "quotation" could be assembled from scattered words into a sentence the
 * document never contains — the precise failure the verbatim rule exists
 * to prevent. A single span keeps whatever rule its caller already
 * applied, so nothing about existing single-span behaviour changes.
 */
export function checkVerbatim(
	quotation: string,
	content: string,
	minimumSpanLength: number
): VerbatimCheck {
	const spans = verbatimSpans(quotation);
	if (spans.length === 0) {
		return { ok: false, reason: 'the quotation is empty' };
	}

	const haystack = normaliseForComparison(content);
	for (const span of spans) {
		const needle = normaliseForComparison(span);
		if (spans.length > 1 && needle.length < minimumSpanLength) {
			return {
				ok: false,
				reason:
					`one side of the quotation, ${JSON.stringify(span)}, is too short to be evidence ` +
					`on its own — a quotation that elides has to stand up span by span`
			};
		}
		if (!haystack.includes(needle)) {
			return {
				ok: false,
				reason:
					spans.length > 1
						? `one side of the quotation, ${JSON.stringify(span)}, is not verbatim in the document`
						: `${JSON.stringify(quotation)} is not verbatim in the document`
			};
		}
	}
	return { ok: true };
}
