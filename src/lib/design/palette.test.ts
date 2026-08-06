import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import {
	CATEGORICAL,
	CERTAINTY_TIERS,
	STATUS,
	STATUS_LEVELS,
	categorical,
	certainty,
	surface,
	type ColorScheme
} from './palette';
import { contrast, validate, validateOrdinal } from './palette-validator';

const here = dirname(fileURLToPath(import.meta.url));

// ── palette passes validation in both schemes ───────────────────────────
// Adjacent pairlist: the encoding these eight slots are used for in this
// wave (stacked/bar charts) only ever puts neighbours side by side.
describe.each(['light', 'dark'] satisfies ColorScheme[])(
	'categorical palette (%s, adjacent)',
	(scheme) => {
		const result = validate(categorical(scheme), { mode: scheme, pairs: 'adjacent' });

		test('passes every hard gate', () => {
			expect(result.ok, JSON.stringify(result.report, null, 2)).toBe(true);
		});

		test('sub-3:1 marks are flagged as relief, not silently dropped', () => {
			const contrastRow = result.report.find((r) => r.name === 'Contrast vs surface');
			// A WARN here is legal only because every chart primitive in this
			// system ships a mandatory table view (see chart-frame.svelte) — the
			// documented relief channel. It is not a loosened threshold.
			expect(['pass', 'relief']).toContain(contrastRow?.state);
		});
	}
);

// Client-concentration bars are horizontal bars, not a scatter/bubble/map/
// small-multiples form, so `adjacent` is the correct pairlist for them too.
// This project caps at three series for any *all-pairs* chart form should
// one appear later — verified here so that cap stays true if it ever does.
describe.each(['light', 'dark'] satisfies ColorScheme[])(
	'categorical palette (%s, all-pairs, first 3 slots)',
	(scheme) => {
		test('the first three slots clear the harder all-pairs gate', () => {
			const result = validate(categorical(scheme).slice(0, 3), { mode: scheme, pairs: 'all' });
			expect(result.ok, JSON.stringify(result.report, null, 2)).toBe(true);
		});
	}
);

test('categorical order is fixed and identical across schemes', () => {
	expect(CATEGORICAL.map((s) => s.slot)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
	expect(categorical('light')).toHaveLength(8);
	expect(categorical('dark')).toHaveLength(8);
});

// ── certainty ramp: ordinal, one hue, designed per scheme ───────────────
describe.each(['light', 'dark'] satisfies ColorScheme[])('certainty ramp (%s)', (scheme) => {
	test('reads as an ordered one-hue ramp, darkest (committed) first', () => {
		const tiers = certainty(scheme);
		const ramp = CERTAINTY_TIERS.map((t) => tiers[t]);
		const result = validateOrdinal(ramp, { mode: scheme });
		expect(result.ok, JSON.stringify(result.report, null, 2)).toBe(true);
	});
});

test('the two certainty ramps are their own steps, not one inverted into the other', () => {
	const light = certainty('light');
	const dark = certainty('dark');
	for (const tier of CERTAINTY_TIERS) {
		expect(dark[tier].toLowerCase()).not.toBe(light[tier].toLowerCase());
	}
});

// ── status: fixed scale, WCAG text contrast, documented relief on light ──
describe('status palette', () => {
	test('good and critical clear 3:1 on both surfaces', () => {
		expect(contrast(STATUS.good, surface('light').surface)).toBeGreaterThanOrEqual(3);
		expect(contrast(STATUS.good, surface('dark').surface)).toBeGreaterThanOrEqual(3);
		expect(contrast(STATUS.critical, surface('light').surface)).toBeGreaterThanOrEqual(3);
		expect(contrast(STATUS.critical, surface('dark').surface)).toBeGreaterThanOrEqual(3);
	});

	// Loosened threshold, documented: warning and serious sit below 3:1 on
	// the light surface by design (see references/palette.md in the dataviz
	// skill). The mitigation is structural, not a convention — StatusIndicator
	// requires an icon and a label prop, so the color is never the only
	// carrier of meaning. This test locks the known values so a future
	// palette edit cannot silently regress past this documented exception.
	test('warning and serious are below 3:1 on light — the documented relief case', () => {
		expect(contrast(STATUS.warning, surface('light').surface)).toBeLessThan(3);
		expect(contrast(STATUS.serious, surface('light').surface)).toBeLessThan(3);
	});

	test('all four status colors clear 3:1 on dark', () => {
		for (const level of STATUS_LEVELS) {
			expect(contrast(STATUS[level], surface('dark').surface)).toBeGreaterThanOrEqual(3);
		}
	});

	test('status is a fixed scale — identical regardless of scheme', () => {
		// STATUS has one value per level, not one per scheme: there is nothing
		// to compare against a dark variant because none exists, by design.
		expect(Object.keys(STATUS)).toEqual(STATUS_LEVELS);
	});
});

// ── negative controls: the validator must fail palettes that deserve to fail ──
// Every check above only proves the shipped palette passes. None of it proves
// the validator would catch a bad one instead of rubber-stamping anything —
// these do, one deliberately broken palette per gate.
describe('validator negative controls', () => {
	test('four identical grays fail chroma floor, CVD and normal-vision separation', () => {
		const result = validate(['#888888', '#888888', '#888888', '#888888'], { mode: 'light' });
		expect(result.ok).toBe(false);
		const byName = Object.fromEntries(result.report.map((r) => [r.name, r.state]));
		expect(byName['Chroma floor']).toBe(false);
		expect(byName['CVD separation']).toBe('fail');
		expect(byName['Normal-vision floor']).toBe('fail');
	});

	test('near-black and near-white fail the lightness band', () => {
		const result = validate(['#050505', '#fafafa'], { mode: 'light' });
		expect(result.ok).toBe(false);
		expect(result.report.find((r) => r.name === 'Lightness band')?.state).toBe(false);
	});

	test('the good/critical status pair collapses under simulated deuteranopia even though it reads apart in normal vision', () => {
		// This is exactly why StatusIndicator pairs every status color with a shape and a label
		// instead of relying on good-vs-critical hue alone.
		const result = validate(['#d03b3b', '#0ca30c'], { mode: 'light', pairs: 'all' });
		const cvd = result.report.find((r) => r.name === 'CVD separation');
		const normal = result.report.find((r) => r.name === 'Normal-vision floor');
		expect(normal?.state).toBe('pass');
		expect(cvd?.state).toBe('fail');
		expect(result.ok).toBe(false);
	});

	test('a ramp given out of lightness order fails monotonicity', () => {
		const result = validateOrdinal(['#3fae3f', '#0a3a0a', '#8fd98f'], { mode: 'light' });
		expect(result.ok).toBe(false);
		expect(result.report.find((r) => r.name === 'Lightness monotone')?.state).toBe(false);
	});

	test('a ramp with two visually identical steps fails the adjacent-ΔL gate', () => {
		const result = validateOrdinal(['#0d366b', '#0d376c', '#cde2fb'], { mode: 'light' });
		expect(result.ok).toBe(false);
		expect(result.report.find((r) => r.name === 'Adjacent \u0394L')?.state).toBe(false);
	});

	test('a three-hue rainbow is rejected as an ordinal ramp for spanning more than one hue', () => {
		const result = validateOrdinal(['#104281', '#0ca30c', '#e34948'], { mode: 'light' });
		expect(result.ok).toBe(false);
		expect(result.report.find((r) => r.name === 'Single hue')?.state).toBe(false);
	});
});

// ── palette.css and palette.ts never drift ───────────────────────────────
interface CssBlock {
	readonly selector: string;
	readonly vars: Readonly<Record<string, string>>;
}

function parseCssBlocks(css: string): CssBlock[] {
	const blocks: CssBlock[] = [];
	let i = 0;
	while (i < css.length) {
		const brace = css.indexOf('{', i);
		if (brace === -1) break;
		const selector = css.slice(i, brace).trim();
		let depth = 1;
		let j = brace + 1;
		while (j < css.length && depth > 0) {
			if (css[j] === '{') depth++;
			else if (css[j] === '}') depth--;
			j++;
		}
		const body = css.slice(brace + 1, j - 1);
		if (selector.startsWith('@media')) {
			for (const nested of parseCssBlocks(body)) {
				blocks.push({ selector: `${selector} ${nested.selector}`, vars: nested.vars });
			}
		} else {
			const vars: Record<string, string> = {};
			for (const m of body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
				vars[m[1]] = m[2].trim().toLowerCase();
			}
			if (Object.keys(vars).length) blocks.push({ selector, vars });
		}
		i = j;
	}
	return blocks;
}

function expectedVars(scheme: ColorScheme, includeStatus: boolean): Record<string, string> {
	const s = surface(scheme);
	const cat = categorical(scheme);
	const tiers = certainty(scheme);
	const vars: Record<string, string> = {
		'surface-1': s.surface,
		'surface-page': s.page,
		'text-primary': s.textPrimary,
		'text-secondary': s.textSecondary,
		'text-muted': s.textMuted,
		'grid-line': s.gridline,
		'axis-line': s.axis,
		'delta-good': s.deltaGood,
		'border-hairline': s.border,
		'certainty-committed': tiers.committed,
		'certainty-projected': tiers.projected,
		'certainty-pipeline': tiers.pipeline
	};
	cat.forEach((hex, i) => (vars[`series-${i + 1}`] = hex));
	if (includeStatus) {
		for (const level of STATUS_LEVELS) vars[`status-${level}`] = STATUS[level];
	}
	return Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, v.toLowerCase()]));
}

const css = readFileSync(join(here, 'palette.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const blocks = parseCssBlocks(css);

test('palette.css declares exactly the light, media-dark and data-theme-dark blocks expected', () => {
	const selectors = blocks.map((b) => b.selector);
	expect(selectors).toEqual([
		':root',
		"@media (prefers-color-scheme: dark) :root:where(:not([data-theme='light']))",
		":root[data-theme='dark']"
	]);
});

test('the :root block matches palette.ts for the light scheme, including status', () => {
	const root = blocks.find((b) => b.selector === ':root');
	expect(root?.vars).toEqual(expectedVars('light', true));
});

test.each([
	[
		'media-query dark',
		"@media (prefers-color-scheme: dark) :root:where(:not([data-theme='light']))"
	],
	['data-theme dark', ":root[data-theme='dark']"]
])('the %s block matches palette.ts for the dark scheme', (_label, selector) => {
	const block = blocks.find((b) => b.selector === selector);
	expect(block?.vars).toEqual(expectedVars('dark', false));
});

test('the media-query dark block and the data-theme dark block agree', () => {
	const media = blocks.find((b) => b.selector.startsWith('@media'));
	const dataTheme = blocks.find((b) => b.selector === ":root[data-theme='dark']");
	expect(media?.vars).toEqual(dataTheme?.vars);
});
