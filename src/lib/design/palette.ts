/**
 * The chart color system: a typed accessor over the values also declared as
 * CSS custom properties in `palette.css`. Charts read colors through this
 * module (or the `--series-*` / `--certainty-*` / `--status-*` custom
 * properties directly in markup) — never a hardcoded hex in component code.
 *
 * Every value here is validated by `palette.test.ts` against the checks in
 * `palette-validator.ts` (an OKLCH lightness band, a chroma floor, CVD
 * separation, a normal-vision separation floor, and contrast against the
 * surface it is drawn on) and kept in sync with `palette.css` by the same
 * test file, so the two never drift.
 *
 * Values are the `dataviz` skill's reference palette (see
 * `references/palette.md`): eight categorical hues in fixed order, a
 * single-hue sequential ramp, and a fixed status scale, each with light and
 * dark steps designed as their own set rather than a mechanical inversion.
 */

export type ColorScheme = 'light' | 'dark';

// ── categorical: identity, fixed order, never cycled ───────────────────
export interface CategoricalSlot {
	/** 1-indexed position — the order is the CVD-safety mechanism and never changes. */
	readonly slot: number;
	readonly hue: string;
	readonly light: string;
	readonly dark: string;
}

export const CATEGORICAL: readonly CategoricalSlot[] = [
	{ slot: 1, hue: 'blue', light: '#2a78d6', dark: '#3987e5' },
	{ slot: 2, hue: 'orange', light: '#eb6834', dark: '#d95926' },
	{ slot: 3, hue: 'aqua', light: '#1baf7a', dark: '#199e70' },
	{ slot: 4, hue: 'yellow', light: '#eda100', dark: '#c98500' },
	{ slot: 5, hue: 'magenta', light: '#e87ba4', dark: '#d55181' },
	{ slot: 6, hue: 'green', light: '#008300', dark: '#008300' },
	{ slot: 7, hue: 'violet', light: '#4a3aa7', dark: '#9085e9' },
	{ slot: 8, hue: 'red', light: '#e34948', dark: '#e66767' }
];

/**
 * The eight categorical hexes in fixed slot order for `scheme`. `adjacent`
 * chart forms (stacks, bars, lines) may use all eight; `all`-pairs forms
 * (scatter, bubble, choropleth, small multiples) cap at the first three
 * slots — see `palette.test.ts`.
 */
export function categorical(scheme: ColorScheme): readonly string[] {
	return CATEGORICAL.map((s) => s[scheme]);
}

// ── sequential: magnitude, one hue, light -> dark ───────────────────────
/** The full continuous ramp (blue), for continuous magnitude encodings (heatmaps, choropleths). */
export const SEQUENTIAL_STEPS = [
	100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700
] as const;
export type SequentialStep = (typeof SEQUENTIAL_STEPS)[number];

export const SEQUENTIAL: Readonly<Record<SequentialStep, string>> = {
	100: '#cde2fb',
	150: '#b7d3f6',
	200: '#9ec5f4',
	250: '#86b6ef',
	300: '#6da7ec',
	350: '#5598e7',
	400: '#3987e5',
	450: '#2a78d6',
	500: '#256abf',
	550: '#1c5cab',
	600: '#184f95',
	650: '#104281',
	700: '#0d366b'
};

// ── certainty: an ordinal (discrete, ordered) instance of the sequential ramp ──
/**
 * Cash certainty is a magnitude, not an identity: committed, projected and
 * pipeline are one hue from dark (most certain) to pale (least), never three
 * separate hues. The two modes pick different steps of the shared ramp — the
 * light triplet stays clear of the pale steps that recede into a light
 * surface, the dark triplet stays clear of the dark steps that recede into a
 * near-black one — rather than inverting one set into the other.
 */
export type CertaintyTier = 'committed' | 'projected' | 'pipeline';
export const CERTAINTY_TIERS: readonly CertaintyTier[] = ['committed', 'projected', 'pipeline'];

const CERTAINTY_RAMP: Record<ColorScheme, Readonly<Record<CertaintyTier, string>>> = {
	light: { committed: SEQUENTIAL[650], projected: SEQUENTIAL[450], pipeline: SEQUENTIAL[250] },
	dark: { committed: SEQUENTIAL[600], projected: SEQUENTIAL[350], pipeline: SEQUENTIAL[150] }
};

/** The three certainty hexes for `scheme`, darkest (committed) first. */
export function certainty(scheme: ColorScheme): Readonly<Record<CertaintyTier, string>> {
	return CERTAINTY_RAMP[scheme];
}

// ── status: state, small fixed scale, reserved meaning, never themed ───
export type StatusLevel = 'good' | 'warning' | 'serious' | 'critical';
export const STATUS_LEVELS: readonly StatusLevel[] = ['good', 'warning', 'serious', 'critical'];

/**
 * Fixed status scale — identical in light and dark, distinct from every
 * categorical slot so a status color never impersonates a series. On the
 * light surface `warning` and `serious` sit below the 3:1 mark floor by
 * design: `StatusIndicator` is the mitigation, pairing every status color
 * with an icon and a label so the color is never load-bearing alone.
 */
export const STATUS: Readonly<Record<StatusLevel, string>> = {
	good: '#0ca30c',
	warning: '#fab219',
	serious: '#ec835a',
	critical: '#d03b3b'
};

// ── surfaces & chrome: designed per scheme, not inverted ───────────────
export interface SurfaceTokens {
	readonly surface: string;
	readonly page: string;
	readonly textPrimary: string;
	readonly textSecondary: string;
	readonly textMuted: string;
	readonly gridline: string;
	readonly axis: string;
	readonly deltaGood: string;
	readonly border: string;
}

const SURFACES: Record<ColorScheme, SurfaceTokens> = {
	light: {
		surface: '#fcfcfb',
		page: '#f9f9f7',
		textPrimary: '#0b0b0b',
		textSecondary: '#52514e',
		textMuted: '#898781',
		gridline: '#e1e0d9',
		axis: '#c3c2b7',
		deltaGood: '#006300',
		border: 'rgba(11, 11, 11, 0.1)'
	},
	dark: {
		surface: '#1a1a19',
		page: '#0d0d0d',
		textPrimary: '#ffffff',
		textSecondary: '#c3c2b7',
		textMuted: '#898781',
		gridline: '#2c2c2a',
		axis: '#383835',
		deltaGood: '#0ca30c',
		border: 'rgba(255, 255, 255, 0.1)'
	}
};

export function surface(scheme: ColorScheme): SurfaceTokens {
	return SURFACES[scheme];
}
