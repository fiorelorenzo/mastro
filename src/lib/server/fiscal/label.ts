// Pack-supplied presentational labels (#67). Legal strings — statutory
// citations, tax treatment codes, mandatory invoice annotations — are a
// different type on purpose: see `$lib/legal/legal-text` for why, and
// `label.test.ts` for the standing proof that the two are not
// interchangeable (AGENTS.md invariant 5).

/** Interface languages mastro ships. Mirrors the i18n layer's language set. */
export type SupportedLanguage = 'en' | 'it';

/**
 * A pack-supplied presentational label: one string per interface language,
 * written by whoever authored the pack. Safe to display as ordinary UI copy
 * — the pack has already done the translation, there is nothing left for a
 * `t()` call to do: read it with `bundle[language]`, nothing more is
 * sanctioned or needed.
 *
 * Keyed by `SupportedLanguage`, a closed union, not by an open
 * `Record<string, string>`: a pack whose bundle omits an entry for a
 * supported language fails `pnpm check`, the same way a missing message
 * catalogue key does (#67) — there is no fallback path to fall into
 * silently. Adding a country brings its strings with it; adding an
 * interface language is the one change that ripples through every pack,
 * and the compiler is what catches the ones a translator missed.
 */
export type LabelBundle = Readonly<Record<SupportedLanguage, string>>;
