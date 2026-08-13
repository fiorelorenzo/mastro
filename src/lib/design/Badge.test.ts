// Badge has no @testing-library/svelte in this project yet (see
// badge-variants.ts's doc comment), so this covers the pure logic that
// backs the component: the variant/size vocabularies and the "every
// variant carries its own glyph" guarantee the component template relies
// on (ux-review #154 — the one place that guarantee used to lapse was the
// count/pill variant, which is why it is asserted here rather than assumed).

import { describe, expect, test } from 'vitest';
import { BADGE_GLYPH, BADGE_SIZES, BADGE_VARIANTS, type BadgeVariant } from './badge-variants';

describe('BADGE_VARIANTS', () => {
	test('is exactly the seven variants the design specifies', () => {
		expect([...BADGE_VARIANTS].sort()).toEqual(
			['critical', 'count', 'good', 'info', 'neutral', 'serious', 'warning'].sort()
		);
	});

	test('has no duplicate variant', () => {
		expect(new Set(BADGE_VARIANTS).size).toBe(BADGE_VARIANTS.length);
	});
});

describe('BADGE_SIZES', () => {
	test('is sm and md only', () => {
		expect(BADGE_SIZES).toEqual(['sm', 'md']);
	});
});

describe('BADGE_GLYPH', () => {
	test('defines a glyph for every variant', () => {
		for (const variant of BADGE_VARIANTS) {
			expect(BADGE_GLYPH[variant], `${variant} has no glyph`).toBeTruthy();
		}
	});

	test('every variant is distinguishable in greyscale: no two variants share a glyph', () => {
		const glyphs = BADGE_VARIANTS.map((variant) => BADGE_GLYPH[variant]);
		expect(new Set(glyphs).size).toBe(BADGE_VARIANTS.length);
	});

	test('count — the variant the audit flagged as colour-only — has its own glyph too', () => {
		const countGlyph = BADGE_GLYPH.count;
		const others = BADGE_VARIANTS.filter((v): v is Exclude<BadgeVariant, 'count'> => v !== 'count');
		for (const variant of others) {
			expect(BADGE_GLYPH[variant]).not.toBe(countGlyph);
		}
	});
});
