// The shared callbackURL guard for both sign-in entry points (#302). It used
// to be a two-clause check duplicated verbatim in
// `src/routes/sign-in/+page.server.ts` and
// `src/routes/sign-in/google/+server.ts`: `startsWith('/')` and
// `!startsWith('//')`. `url.searchParams.get` hands back the
// percent-decoded value, so `%5C` arrives as a literal backslash, and every
// major browser normalises a `Location` header path starting `/\` to `//`,
// i.e. protocol-relative. The blocklist never accounted for that.
//
// This resolves the candidate against the app's own origin with
// `new URL(candidate, origin)` and keeps it only if the resolved origin
// still matches: that is positive validation, not exclusion, so backslashes,
// protocol-relative forms, absolute URLs and encoded variants are all
// rejected by construction rather than by a growing list of special cases.

/**
 * Resolves a caller-supplied `callbackURL` against `origin`, keeping it only
 * if it stays on the same origin. Anything else — an absolute URL, a
 * protocol-relative or backslash-prefixed path, a `javascript:` URL, or an
 * empty/missing value — falls back to `fallback` (defaults to `/`).
 */
export function resolveCallbackURL(
	candidate: string | null | undefined,
	origin: string,
	fallback = '/'
): string {
	if (!candidate) return fallback;

	let resolved: URL;
	try {
		resolved = new URL(candidate, origin);
	} catch {
		return fallback;
	}

	return resolved.origin === origin
		? resolved.pathname + resolved.search + resolved.hash
		: fallback;
}
