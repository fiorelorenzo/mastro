/**
 * `Banner`'s tone vocabulary (#207). Shares its glyph table with `Badge`'s
 * own `BADGE_GLYPH` rather than inventing a second one: `info`/`warning`/
 * `critical` already mean the same thing wherever a badge uses them, and a
 * banner is the same severity scale at prose length instead of one word.
 *
 * Kept as a plain module, not inlined in `Banner.svelte`, for the same
 * reason `badge-variants.ts`/`error-status.ts` are: the tone → role/glyph
 * mapping is unit-testable without a component renderer (no
 * `@testing-library/svelte` dependency here — see `Table.svelte`'s own
 * comment on that).
 */
import { BADGE_GLYPH, type BadgeVariant } from './badge-variants';

export const BANNER_TONES = ['info', 'warning', 'critical'] as const;
export type BannerTone = (typeof BANNER_TONES)[number];

/** The same character `Badge` renders for the equivalent variant — colour
 *  is never the only thing distinguishing one banner's tone from another. */
export function bannerGlyph(tone: BannerTone): string {
	return BADGE_GLYPH[tone as BadgeVariant];
}

/** `critical` is the assertive sibling (ErrorState's own reasoning: worth
 *  interrupting) — `info`/`warning` are ambient, `role="status"`. */
export function bannerRole(tone: BannerTone): 'status' | 'alert' {
	return tone === 'critical' ? 'alert' : 'status';
}
