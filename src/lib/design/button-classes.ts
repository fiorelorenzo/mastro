/**
 * The pure half of `Button.svelte`: variant/size to class name, and the
 * loading/disabled relationship. Split out so it can be unit-tested without
 * `@testing-library/svelte` (not a dependency here) — see `RecordList`'s
 * `types.ts` for the same pattern.
 *
 * Five visual button languages existed before this (#`2026-08-13` UX
 * review counted 21 distinct button class strings); this file is the one
 * mapping every future button variant and size resolves through.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

/** `btn btn--<variant> btn--<size>`, the full class list for the element. */
export function buttonClasses(variant: ButtonVariant, size: ButtonSize): string {
	return `btn btn--${variant} btn--${size}`;
}

/**
 * `loading` implies `disabled`: a button mid-submit must not accept a second
 * click, whether or not the caller remembered to pass `disabled` too.
 */
export function isButtonBlocked(disabled: boolean, loading: boolean): boolean {
	return disabled || loading;
}

/** `aria-busy` is present (and `"true"`) only while loading, never `"false"`. */
export function buttonAriaBusy(loading: boolean): 'true' | undefined {
	return loading ? 'true' : undefined;
}
