/**
 * Badge — the single shape/glyph/colour vocabulary every status-carrying
 * chip in the product now draws from (ux-review #57/#154). Three unrelated
 * pill implementations existed before this: the sidebar's hairline nav
 * count, the dashboard's filled proposals-pending pill, and
 * `DayStateBadge`'s glyph-plus-label pattern. `StatusIndicator.svelte`
 * (`$lib/design/charts`) already enforces "a status colour never renders
 * without its own glyph" for the four-level chart status scale; this
 * module extends the same discipline to every interface badge, including
 * `count` — the one place the guarantee used to lapse (ux-review #154:
 * "the number has no shape distinguishing '0 unread' from '3 unread'
 * beyond a border").
 *
 * Kept as a plain module, not inlined in `Badge.svelte`, so the variant ↔
 * glyph mapping is unit-testable without a component renderer: this
 * project has no `@testing-library/svelte` dependency yet (see
 * `Badge.test.ts`).
 */

export const BADGE_VARIANTS = [
	'neutral',
	'info',
	'good',
	'warning',
	'serious',
	'critical',
	'count'
] as const;

export type BadgeVariant = (typeof BADGE_VARIANTS)[number];

export const BADGE_SIZES = ['sm', 'md'] as const;
export type BadgeSize = (typeof BADGE_SIZES)[number];

/**
 * One glyph per variant, distinct enough to survive greyscale print and
 * full-severity colour vision deficiency before the label is ever read —
 * plain characters rather than `StatusIndicator`'s SVG outlines because a
 * badge sits inline with dense text (table cells, nav rows) at a size
 * where a glyph that scales with the font metrics reads better than a
 * fixed-size icon box.
 */
export const BADGE_GLYPH: Readonly<Record<BadgeVariant, string>> = {
	neutral: '○',
	info: '◇',
	good: '●',
	warning: '▲',
	serious: '◆',
	critical: '■',
	count: '#'
};
