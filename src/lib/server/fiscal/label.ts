// Two shapes of pack-supplied string, and they are deliberately not the same
// type. See AGENTS.md invariant 5: legal strings are never translated.

/** Interface languages mastro ships. Mirrors the i18n layer's language set. */
export type SupportedLanguage = 'en' | 'it';

/**
 * A pack-supplied presentational label: one string per interface language,
 * written by whoever authored the pack. Safe to display as ordinary UI copy
 * — the pack has already done the translation, there is nothing left for a
 * `t()` call to do.
 */
export type LabelBundle = Readonly<Record<SupportedLanguage, string>>;

/**
 * A legal string: a statutory citation, a tax-treatment code's mandated
 * wording, an invoice annotation the law requires verbatim. It renders in
 * the language the law was written in — which need not be, and often is
 * not, one of `SupportedLanguage` — never in the interface language, and it
 * is never translated.
 *
 * The shape is deliberately incompatible with `LabelBundle`: a `LabelBundle`
 * is keyed by `en`/`it`, this is keyed by `kind`/`language`/`text`. Handing
 * a `LegalText` to anything typed to accept a `LabelBundle` (a translation
 * helper, a label renderer) is a compile error, not a runtime bug waiting
 * for the first translator who finds an unfamiliar string and "fixes" it.
 * See `label.test.ts` for the standing proof.
 */
export interface LegalText {
	readonly kind: 'legal-text';
	/** BCP 47 tag of the language the law was written in, e.g. `'it'`. */
	readonly language: string;
	readonly text: string;
}

export function legalText(language: string, text: string): LegalText {
	return { kind: 'legal-text', language, text };
}
