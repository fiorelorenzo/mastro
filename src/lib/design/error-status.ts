/**
 * Pure status → presentation mapping, shared by `ErrorState.svelte` (the
 * status chip's colour) and `+error.svelte` (which generic title/body to
 * fall back to when the thrown error carried no real explanation). Kept
 * framework-free and side-effect-free so it is testable without a
 * component harness the project does not depend on (#199).
 */

export type ErrorSeverity = 'warning' | 'critical';

/**
 * 404 reads as critical even though it is a 4xx — the thing is simply
 * gone, and there is nothing the visitor can do about it — matching the
 * mockup (`docs/specs/ux-review/mockups/mastro-mockup.html`, "Stati di
 * errore") exactly. Every other 4xx is a warning: a guarded state the
 * visitor usually caused and can act on (the classic case is
 * `invoices/[id]/remind`, guarding "this invoice isn't overdue"). 5xx is
 * always critical.
 */
export function errorSeverity(status: number): ErrorSeverity {
	return status >= 500 || status === 404 ? 'critical' : 'warning';
}

export type ErrorKind = 'not-found' | 'bad-request' | 'server';

/** Which generic copy `+error.svelte` shows for a status with no usable
 *  explanation of its own. */
export function errorKind(status: number): ErrorKind {
	if (status >= 500) return 'server';
	if (status === 404) return 'not-found';
	return 'bad-request';
}

// SvelteKit fabricates a message when a route handler doesn't supply one:
// `error(status)` with no body becomes `Error: ${status}`, an unmatched
// route becomes `Not Found`, and an uncaught exception's default
// `handleError` becomes `Internal Error` (see
// @sveltejs/kit/src/exports/internal/index.js and
// @sveltejs/kit/src/utils/error.js). None of those three is something to
// show a visitor as if it were a real explanation — that is the unstyled
// bundled fallback's actual bug, just relocated.
const PLACEHOLDER = /^(error: \d+|internal error|not found)$/i;

/** True when `message` is a real, call-site-supplied explanation rather
 *  than one of SvelteKit's own fabricated placeholders. */
export function hasExplanation(message: string | null | undefined): message is string {
	const trimmed = message?.trim();
	return !!trimmed && !PLACEHOLDER.test(trimmed);
}
