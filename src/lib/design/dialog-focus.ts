/**
 * Pure focus-trap arithmetic for `Dialog.svelte`, kept apart from the
 * component for the same reason `segmented-control.ts` is: no DOM in this
 * project's test environment (`vite.config.ts`'s vitest project runs
 * `node`, no jsdom/happy-dom dependency), so the trap can only be unit
 * tested as index arithmetic over "however many focusable elements the
 * container currently has" — `Dialog.svelte` supplies the real
 * `HTMLElement[]` at call time and this module never sees one.
 *
 * #207: 0 dialogs existed before this, so nothing in the product trapped
 * focus, returned it, or closed on Escape.
 */

export type TabDirection = 1 | -1;

/**
 * `Tab`/`Shift+Tab` direction from a keydown event's own fields, or `0` for
 * any key the trap ignores. A plain `{ key, shiftKey }` rather than a real
 * `KeyboardEvent` so this stays callable from a test with a literal object.
 */
export function tabDirection(key: string, shiftKey: boolean): TabDirection | 0 {
	if (key !== 'Tab') return 0;
	return shiftKey ? -1 : 1;
}

/**
 * The next focusable index inside a trapped container, wrapping at both
 * ends: `Tab` from the last focusable element returns to the first,
 * `Shift+Tab` from the first goes to the last — the ARIA APG modal dialog
 * pattern's "focus trap order" requirement, so `Tab` can never walk focus
 * out into the page behind the dialog. `count === 0` (nothing focusable in
 * the dialog yet, e.g. mid-render) returns `-1`: nothing to focus, and no
 * caller should call `.focus()` on that.
 */
export function nextTrappedIndex(count: number, current: number, direction: TabDirection): number {
	if (count === 0) return -1;
	const from = current === -1 ? 0 : current;
	return (from + direction + count) % count;
}

/** Whether `key` is the dialog's dismiss key. One place decides this, the
 *  same discipline `isButtonBlocked` applies to a button's blocked state,
 *  so "which key closes a dialog" is never re-decided ad hoc at a second
 *  call site. */
export function isDismissKey(key: string): boolean {
	return key === 'Escape';
}

/** Every element kind the trap treats as a stop, in the order the ARIA APG
 *  examples use. `[tabindex]` alone is excluded — anything with a negative
 *  tabindex is deliberately out of the tab order, and `Dialog.svelte`
 *  filters those out explicitly rather than trusting the selector to. */
export const FOCUSABLE_SELECTOR = [
	'a[href]',
	'button:not([disabled])',
	'input:not([disabled])',
	'select:not([disabled])',
	'textarea:not([disabled])',
	'[tabindex]:not([tabindex="-1"])'
].join(', ');
