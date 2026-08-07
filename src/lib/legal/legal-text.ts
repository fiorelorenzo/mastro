/**
 * A statutory citation, tax treatment code or mandatory invoice annotation.
 *
 * Legal strings are data, not copy (AGENTS.md invariant 5): a jurisdiction
 * pack supplies them already in the language the law requires, and they
 * render verbatim regardless of the interface language. `LegalText` carries
 * that language explicitly — it need not be, and often is not, one of the
 * interface languages `mastro` ships — so a pack can say which language a
 * given statutory string is written in, independently of what the reader
 * has their UI set to.
 *
 * This module is free-standing: it has no dependency on the i18n layer, on
 * `$lib/paraglide`, or on the jurisdiction pack module that supplies
 * `LegalText` values (see #30, #67). Anything that needs the type — a pack,
 * a component, a test — imports only this file. In particular it lives
 * under `$lib/legal`, not `$lib/server/fiscal`, because `LegalText.svelte`
 * renders it client-side and SvelteKit refuses to bundle anything from
 * `$lib/server` into client code.
 *
 * `LegalText` reconciles what were two separate types on two wave-1
 * branches that could not see each other: a branded-string `LegalString`
 * here, and this same `kind`/`language`/`text` shape under
 * `$lib/server/fiscal/label.ts`. The fiscal shape survived because it is
 * the one that carries the language field invariant 5 requires; only its
 * location moved, to the framework-agnostic home a Svelte component can
 * import from.
 */

export interface LegalText {
	readonly kind: 'legal-text';
	/** BCP 47 tag of the language the law was written in, e.g. `'it'`. */
	readonly language: string;
	readonly text: string;
}

/**
 * The one sanctioned way to construct a `LegalText`. Centralising it here,
 * instead of an object literal at every call site, keeps "this text is
 * legally verbatim" a single, greppable decision — the caller vouches that
 * `text` already is what the law requires, in the language it requires it
 * in.
 */
export function legalText(language: string, text: string): LegalText {
	return { kind: 'legal-text', language, text };
}
