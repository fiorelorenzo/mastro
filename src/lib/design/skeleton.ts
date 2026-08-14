/**
 * `Skeleton`'s pure half (#207): the shape vocabulary and the one genuine
 * decision a shape-only placeholder still has to make — how wide each line
 * of a multi-line text placeholder is. Kept apart from `Skeleton.svelte`
 * the same way every other variant table in this directory is, so it is
 * testable without a component renderer.
 */

export const SKELETON_SHAPES = ['text', 'circle', 'block'] as const;
export type SkeletonShape = (typeof SKELETON_SHAPES)[number];

/** The last line of a multi-line text placeholder, as a percentage of the
 *  container width — real prose does not end a paragraph flush with the
 *  margin, so a placeholder whose every line is 100% reads as a single
 *  suspicious rectangle stack rather than "text is loading here." */
const LAST_LINE_WIDTH_PERCENT = 60;

/**
 * One width per requested line, every line but the last at 100%, the last
 * shortened by `LAST_LINE_WIDTH_PERCENT` (skipped for a single line — one
 * line has no "last line" distinct from itself, so it stays full width).
 * `lines <= 0` is the empty placeholder: no lines to draw.
 */
export function skeletonLineWidths(lines: number): number[] {
	if (lines <= 0) return [];
	return Array.from({ length: lines }, (_, index) =>
		index === lines - 1 && lines > 1 ? LAST_LINE_WIDTH_PERCENT : 100
	);
}
