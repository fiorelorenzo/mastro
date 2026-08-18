// `CspDirectives` (the interface SvelteKit types `kit.csp.directives`
// against) is declared inside `declare module '@sveltejs/kit'` without its
// own `export` keyword, so it isn't importable by name — but `vite.config.ts`
// still gets full structural checking for free the moment it passes
// `CSP_DIRECTIVES` into `sveltekit({ csp: { directives: … } })`, since that
// call site's own parameter type references the same (unexported)
// interface. `CspSource` below is a local, narrower stand-in for the
// framework's own `Csp.Source` union (also unexported) — just the handful
// of quoted keywords `CSP_DIRECTIVES` actually uses — so each directive's
// array stays a literal union assignable to what `CspDirectives` expects,
// rather than widening to plain `string[]`, which is not.
type CspSource = 'self' | 'none' | 'unsafe-inline' | 'data:';

// Shared between the two call sites that need this and cannot share a
// header string directly (#303): `vite.config.ts`'s `kit.csp` block, which
// needs the structured directive map so SvelteKit can append its own nonce
// source to `script-src`/`style-src` for every inline `<script>`/`<style>`
// it renders on a page, and `hooks.server.ts`, which needs a plain header
// string for the responses `kit.csp` never touches at all — it only ever
// sets a `Content-Security-Policy` header on rendered HTML pages
// (`@sveltejs/kit/src/runtime/server/page/render.js`), never on a
// `+server.ts` endpoint, which has no inline script or style for a nonce to
// protect in the first place.
//
// Strict from `default-src` down: no plugin origin (`object-src: none`), no
// rewriting `<base>` (`base-uri: self`), never framed by another origin
// (`frame-ancestors: none`). The one relaxation is `style-src`: several
// dashboard charts (`CashCalendarChart`, `CeilingMeter`,
// `ConcentrationChart`, the shared `Legend`/`Tooltip`/`Skeleton`) colour
// themselves with Svelte's `style:` directive, which server-renders as a
// plain inline `style="..."` attribute on the element. A CSP nonce only
// ever covers `<script>`/`<style>` *elements* — there is no `nonce-` token
// for `style-src-attr`, the directive that actually governs an inline
// attribute — so the only way to keep those working is `'unsafe-inline'`
// on `style-src`. Kept narrow to that one directive rather than widened
// onto `default-src`, and left off `script-src` entirely, since the one
// hand-written pre-paint script moved out of `src/app.html` into
// `static/theme-init.js` and is now a same-origin external file that
// `script-src`'s fallback to `default-src 'self'` already allows.
//
// `img-src` is the second relaxation, and it broke on the very first page
// load: `src/routes/+layout.svelte` links `rel="icon"` to
// `src/lib/assets/favicon.svg`, which Vite inlines as a `data:` URI
// because it is under the asset inlining threshold, and `default-src
// 'self'` blocks a `data:` image. `data:` is only permitted for images,
// where it cannot execute anything, rather than being widened onto
// `default-src` where it would also cover script and frame sources.
export const CSP_DIRECTIVES: Record<string, CspSource[]> = {
	'default-src': ['self'],
	'object-src': ['none'],
	'base-uri': ['self'],
	'frame-ancestors': ['none'],
	'style-src': ['self', 'unsafe-inline'],
	'img-src': ['self', 'data:']
};

/** The CSP source tokens that need surrounding quotes in the header value —
 * mirrors the list `@sveltejs/kit/src/runtime/server/page/csp.js` keeps
 * private to the framework. Not exhaustive of every keyword CSP defines,
 * only the ones `CSP_DIRECTIVES` above actually uses. */
const QUOTED_SOURCES: Record<string, true> = {
	self: true,
	none: true,
	'unsafe-inline': true,
	'unsafe-eval': true,
	'strict-dynamic': true
};

function quote(source: string): string {
	return QUOTED_SOURCES[source] ? `'${source}'` : source;
}

/**
 * Renders a directive map shaped like `CSP_DIRECTIVES` into a
 * `Content-Security-Policy` header value. `hooks.server.ts` calls this once,
 * at module load, and reuses the resulting string for every response —
 * `vite.config.ts` passes `CSP_DIRECTIVES` itself, not this string, because
 * SvelteKit needs the structured form to append its own nonce source.
 */
export function formatCspHeader(directives: Record<string, readonly string[]>): string {
	return Object.entries(directives)
		.map(([directive, sources]) => `${directive} ${sources.map(quote).join(' ')}`)
		.join('; ');
}
