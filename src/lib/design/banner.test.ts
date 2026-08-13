import { expect, test } from 'vitest';
import { BADGE_GLYPH } from './badge-variants';
import { bannerGlyph, bannerRole } from './banner';

test('critical is the only tone that interrupts (role=alert); info/warning are ambient status', () => {
	expect(bannerRole('info')).toBe('status');
	expect(bannerRole('warning')).toBe('status');
	expect(bannerRole('critical')).toBe('alert');
});

test('each tone renders the same glyph Badge uses for the equivalent variant', () => {
	expect(bannerGlyph('info')).toBe(BADGE_GLYPH.info);
	expect(bannerGlyph('warning')).toBe(BADGE_GLYPH.warning);
	expect(bannerGlyph('critical')).toBe(BADGE_GLYPH.critical);
});
