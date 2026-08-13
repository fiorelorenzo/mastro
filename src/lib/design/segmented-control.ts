/**
 * Arrow-key navigation for SegmentedControl, kept separate from the
 * component so it is testable without mounting one (segmented-control.svelte
 * uses these two functions verbatim in its keydown handler). A segmented
 * control is a row of toggle buttons acting as one control — not a native
 * `<select>` — so the browser gives it no arrow-key behaviour for free; the
 * ARIA APG "radiogroup"/"segmented button" pattern expects roving tabindex
 * with wraparound, which is what this implements.
 */

export interface SegmentedOption {
	readonly value: string;
	readonly disabled?: boolean;
}

/** Which way an arrow key moves focus, or 0 for a key this control ignores. */
export function keyToDirection(key: string): 1 | -1 | 0 {
	if (key === 'ArrowRight' || key === 'ArrowDown') return 1;
	if (key === 'ArrowLeft' || key === 'ArrowUp') return -1;
	return 0;
}

/**
 * The next enabled option index in `direction` from `current`, wrapping
 * around the ends. Skips disabled options; if every option is disabled (or
 * the list is empty), returns `current` unchanged rather than spinning.
 */
export function nextEnabledIndex(
	options: readonly SegmentedOption[],
	current: number,
	direction: 1 | -1
): number {
	if (options.length === 0) return current;
	let index = current;
	for (let step = 0; step < options.length; step++) {
		index = (index + direction + options.length) % options.length;
		if (!options[index]?.disabled) return index;
	}
	return current;
}
