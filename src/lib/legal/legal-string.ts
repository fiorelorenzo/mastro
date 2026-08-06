/**
 * A statutory citation, tax treatment code or mandatory invoice annotation.
 *
 * Legal strings are data, not copy (AGENTS.md invariant 5): a jurisdiction
 * pack supplies them already in the language the law requires, and they
 * render verbatim regardless of the interface language. `LegalString` is a
 * branded subtype of `string` — assignable anywhere a `string` is expected,
 * including straight into Svelte markup — so displaying one needs no helper.
 * What it must never do is flow into a translation call (see `translate` in
 * `$lib/i18n/translate.ts`, which rejects it at compile time).
 *
 * This module is free-standing: it has no dependency on the i18n layer, on
 * `$lib/paraglide`, or on the jurisdiction pack module that will supply
 * `LegalString` values (see #30). Anything that needs the type — a pack, a
 * component, a test — imports only this file.
 */

declare const legalStringBrand: unique symbol;

export type LegalString = string & { readonly [legalStringBrand]: true };

/**
 * The one sanctioned way to construct a `LegalString`. Centralising the cast
 * here, instead of an `as LegalString` at every call site, keeps "this text
 * is legally verbatim" a single, greppable decision — the caller vouches
 * that `value` already is what the law requires, in the language it
 * requires it in.
 */
export function legalString(value: string): LegalString {
	return value as LegalString;
}
