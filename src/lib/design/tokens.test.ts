// #199: the interface tokens are as checked as the chart palette is.
//
// Two things this file is for. First, the load-bearing separation: the
// interface tokens must never end up inside `palette.css`, whose `:root`
// block `palette.test.ts` asserts exactly — so a well-meaning "tidy these
// into one file" fails here with an explanation rather than there with a
// diff. Second, contrast: a primary button nobody can read is a defect, and
// the tooling to prove it is already in the repo.

import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { contrast } from './palette-validator';

const tokens = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
const palette = readFileSync(new URL('./palette.css', import.meta.url), 'utf8');

/** Every `--name: value;` declared in the block a selector opens. */
function block(css: string, selector: string): Record<string, string> {
	const start = css.indexOf(selector);
	if (start === -1) throw new Error(`no ${selector} in the stylesheet`);
	const open = css.indexOf('{', start);
	const close = css.indexOf('\n}', open);
	const body = css.slice(open + 1, close);
	return Object.fromEntries(
		[...body.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)].map((m) => [m[1], m[2].trim()])
	);
}

const light = block(tokens, ':root {');
const dark = block(tokens, ":root[data-theme='dark'] {");

test('the interface tokens live outside the block palette.test.ts asserts exactly', () => {
	const paletteRoot = block(palette, ':root {');
	const interfaceNames = Object.keys(light);
	expect(interfaceNames.length).toBeGreaterThan(20);
	for (const name of interfaceNames) {
		expect(paletteRoot, `${name} must not be declared in palette.css`).not.toHaveProperty(name);
	}
});

test('the chart palette is not redeclared here, so there is one source for a colour', () => {
	for (const name of Object.keys(block(palette, ':root {'))) {
		expect(light, `${name} belongs to palette.css`).not.toHaveProperty(name);
	}
});

test('every token the dark scheme overrides also exists in light', () => {
	for (const name of Object.keys(dark)) {
		expect(light, `${name} is dark-only`).toHaveProperty(name);
	}
});

test('the explicit dark stamp and the OS-dark media block agree', () => {
	const media = block(tokens, ":root:where(:not([data-theme='light'])) {");
	expect(media).toEqual(dark);
});

// The surfaces these are drawn on come from the chart palette, which owns
// them; light `--surface-1` is #fcfcfb and dark is #1a1a19.
const SURFACE = { light: '#fcfcfb', dark: '#1a1a19' } as const;

test.each([
	['primary fill against its own ink', 'light'],
	['primary fill against its own ink', 'dark'],
	['danger fill against its own ink', 'light'],
	['danger fill against its own ink', 'dark']
] as const)('%s (%s) clears 4.5:1', (label, scheme) => {
	const set = scheme === 'light' ? light : dark;
	const [fill, ink] = label.startsWith('primary')
		? [set['--color-primary'], set['--color-primary-ink']]
		: [set['--color-danger'], set['--color-danger-ink']];
	expect(contrast(fill, ink)).toBeGreaterThanOrEqual(4.5);
});

test.each(['light', 'dark'] as const)(
	'the focus ring is visible against the surface it lands on (%s)',
	(scheme) => {
		const set = scheme === 'light' ? light : dark;
		// 3:1 is the non-text contrast floor a focus indicator has to meet.
		expect(contrast(set['--color-focus'], SURFACE[scheme])).toBeGreaterThanOrEqual(3);
	}
);

test.each(['light', 'dark'] as const)(
	'a link in the primary colour is readable as text on the surface (%s)',
	(scheme) => {
		const set = scheme === 'light' ? light : dark;
		expect(contrast(set['--color-primary'], SURFACE[scheme])).toBeGreaterThanOrEqual(4.5);
	}
);
