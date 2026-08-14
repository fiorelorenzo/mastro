/**
 * `Toast`'s pure half: the tone vocabulary, the live-region politeness each
 * tone resolves to, stack eviction and dismiss-timing arithmetic — kept
 * apart from `toast-store.svelte.ts` (the stateful singleton that actually
 * schedules a `setTimeout`) the same way `install-logic.ts` sits apart from
 * `install.svelte.ts` next to it: no DOM/timer wiring here, so this is
 * testable exactly like `banner.ts`/`button-classes.ts`.
 *
 * #207: 0 `aria-live` regions existed in the product before this.
 */

export const TOAST_TONES = ['neutral', 'success', 'danger'] as const;
export type ToastTone = (typeof TOAST_TONES)[number];

export interface ToastRecord {
	readonly id: string;
	readonly tone: ToastTone;
	readonly message: string;
}

/** How long an auto-dismissing toast stays on screen when the caller does
 *  not ask for something else. Long enough to read a short sentence once. */
export const TOAST_DEFAULT_DURATION_MS = 5000;

/** A caller-supplied duration below this is almost certainly a mistake
 *  (milliseconds confused for seconds) rather than a deliberate "flash it
 *  and gone" — `resolveToastDuration` floors to it instead of honouring a
 *  duration nobody, screen reader or sighted, could read in time. */
export const TOAST_MIN_DURATION_MS = 1500;

/** How many toasts stack at once before the oldest is evicted — unbounded
 *  stacking is what "jumps the layout" the issue calls out; this caps the
 *  fixed-position stack's own height instead of the page's. */
export const TOAST_MAX_STACK = 4;

/**
 * `danger` is the assertive tone — the same discipline `bannerRole` already
 * applies to `Banner`'s `critical`: a failed save is worth interrupting
 * whatever the screen reader is currently reading, `neutral`/`success` are
 * ambient and wait their turn. Toasts wired in this slice are all
 * `neutral`/`success` — `danger` exists so a future failed-save toast has
 * the correct politeness from the day it is added, not a retrofit.
 */
export function toastRole(tone: ToastTone): 'status' | 'alert' {
	return tone === 'danger' ? 'alert' : 'status';
}

/** `aria-live` value matching `toastRole` exactly (`alert` implies
 *  assertive, `status` implies polite) — declared explicitly rather than
 *  left implicit because `role` alone is not reliably enough for every
 *  screen reader to pick up the interruption on a dynamically inserted node. */
export function toastPoliteness(tone: ToastTone): 'polite' | 'assertive' {
	return tone === 'danger' ? 'assertive' : 'polite';
}

/**
 * Appends `toast` to `existing`, evicting from the front once the stack
 * would exceed `max` — the oldest toast is the one that has already had
 * the longest to be read, so it is the one that goes.
 */
export function pushToast(
	existing: readonly ToastRecord[],
	toast: ToastRecord,
	max: number = TOAST_MAX_STACK
): ToastRecord[] {
	const next = [...existing, toast];
	return next.length > max ? next.slice(next.length - max) : next;
}

/** `existing` with `id` removed — a no-op, not an error, if `id` already
 *  dismissed itself (auto-dismiss and a manual click racing each other). */
export function dismissToast(existing: readonly ToastRecord[], id: string): ToastRecord[] {
	return existing.filter((toast) => toast.id !== id);
}

/**
 * The effective auto-dismiss duration in milliseconds, or `null` for a
 * toast that only leaves on a manual dismiss: `undefined` (the caller did
 * not ask for anything specific) resolves to `TOAST_DEFAULT_DURATION_MS`;
 * an explicit `null` opts all the way out; any other explicit value is
 * floored at `TOAST_MIN_DURATION_MS` so a caller cannot accidentally ship
 * an unreadable flash.
 */
export function resolveToastDuration(override: number | null | undefined): number | null {
	if (override === null) return null;
	if (override === undefined) return TOAST_DEFAULT_DURATION_MS;
	return Math.max(override, TOAST_MIN_DURATION_MS);
}
