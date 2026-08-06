/**
 * Validates a categorical chart palette (and, separately, an ordinal ramp)
 * against the computable data-viz checks: OKLCH lightness band, chroma floor,
 * CVD separation under simulated protanopia/deuteranopia (Machado, Oliveira &
 * Fernandes 2009, severity 1.0), a normal-vision separation floor, and
 * contrast against the surface the marks are drawn on.
 *
 * Ported from the `dataviz` skill's reference `validate_palette.js` — same
 * thresholds, same math, typed for use as a project test rather than a CLI.
 * Checks 1 (fixed hue order) and 6 (values come from the documented palette
 * in `palette.ts`) are structural and are not measured here.
 */

export type Mode = 'light' | 'dark';
export type PairScope = 'adjacent' | 'all';
export type CheckState = boolean | 'pass' | 'floor' | 'fail' | 'relief';

export interface CheckRow {
	readonly name: string;
	readonly state: CheckState;
	readonly detail: string;
}

export interface ValidationResult {
	readonly report: readonly CheckRow[];
	readonly ok: boolean;
}

// ── thresholds ───────────────────────────────────────────────────────────
const BAND: Record<Mode, readonly [number, number]> = { light: [0.43, 0.77], dark: [0.48, 0.67] };
const CHROMA_FLOOR = 0.1; // OKLCH C — below this a hue reads as gray
// ΔE is Euclidean distance in OKLab ×100, calibrated to the Machado-Oliveira-
// Fernandes (2009) severity-1.0 simulation below: the sim model is part of
// the standard, not an implementation detail.
const CVD_TARGET = 8.0;
const CVD_FLOOR = 6.0; // legal only with secondary encoding (icon/label/texture)
const NORMAL_FLOOR = 15.0; // hard gate, not excused by secondary encoding
const CONTRAST_MIN = 3.0; // WCAG vs surface, for marks
export const DEFAULT_SURFACE: Record<Mode, string> = { light: '#fcfcfb', dark: '#1a1a19' };
const ORDINAL_MIN_DL = 0.06; // min OKLCH ΔL between adjacent ramp steps
const ORDINAL_LIGHT_FLOOR = 2.0; // nearest-surface ramp step: WCAG contrast vs surface

type Vec3 = readonly [number, number, number];
type CvdKind = 'protan' | 'deutan' | 'tritan';

// Machado, Oliveira & Fernandes (2009) CVD transforms at severity 1.0 (linear RGB).
const MACHADO: Record<CvdKind, readonly [Vec3, Vec3, Vec3]> = {
	protan: [
		[0.152286, 1.052583, -0.204868],
		[0.114503, 0.786281, 0.099216],
		[-0.003882, -0.048116, 1.051998]
	],
	deutan: [
		[0.367322, 0.860646, -0.227968],
		[0.280085, 0.672501, 0.047413],
		[-0.01182, 0.04294, 0.968881]
	],
	tritan: [
		[1.255528, -0.076749, -0.178779],
		[-0.078411, 0.930809, 0.147602],
		[0.004733, 0.691367, 0.3039]
	]
};

// ── color conversions ───────────────────────────────────────────────────
function hex2srgb(h: string): Vec3 {
	const v = h.trim().replace(/^#/, '');
	return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255) as unknown as Vec3;
}

// Every user-supplied color string passes through this normalization before
// any math. ASCII whitespace plus the Unicode space/separator characters —
// covers NBSP/em-space padding picked up when copy-pasting hex lists.
const WS_RUN =
	'[ \\t\\n\\v\\f\\r\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]+';
const stripWs = (v: string) => v.replace(new RegExp(`^${WS_RUN}|${WS_RUN}$`, 'g'), '');
export const isHexColor = (v: string): boolean => /^#?[0-9a-fA-F]{6}$/.test(stripWs(v));

const s2lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lin = (h: string): Vec3 => hex2srgb(h).map(s2lin) as unknown as Vec3;
const relLum = (h: string) => {
	const [r, g, b] = lin(h);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** WCAG contrast ratio between two hex colors. */
export function contrast(a: string, b: string): number {
	const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

function oklabFromLin([r, g, b]: Vec3): Vec3 {
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	return [
		0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
	];
}
const oklab = (h: string) => oklabFromLin(lin(h));

/** OKLCH [L, C] of a hex color (hue omitted — see `okhue`). */
export function oklch(h: string): readonly [number, number] {
	const [L, a, b] = oklab(h);
	return [L, Math.hypot(a, b)];
}
const okhue = (h: string) => {
	const [, a, b] = oklab(h);
	return ((((Math.atan2(b, a) * 180) / Math.PI) % 360) + 360) % 360;
};

function simulate(h: string, kind: CvdKind): Vec3 {
	const [r, g, b] = lin(h);
	const M = MACHADO[kind];
	const clamp = (c: number) => Math.max(0, Math.min(1, c));
	return [
		clamp(M[0][0] * r + M[0][1] * g + M[0][2] * b),
		clamp(M[1][0] * r + M[1][1] * g + M[1][2] * b),
		clamp(M[2][0] * r + M[2][1] * g + M[2][2] * b)
	];
}

/** OKLab ΔE×100 between two colors; pass `kind` to compare under simulated CVD. */
function deltaE(h1: string, h2: string, kind?: CvdKind): number {
	const a = oklabFromLin(kind ? simulate(h1, kind) : lin(h1));
	const b = oklabFromLin(kind ? simulate(h2, kind) : lin(h2));
	return 100 * Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export interface ValidateOptions {
	readonly mode?: Mode;
	readonly surface?: string;
	/** `adjacent` for stacks/bars/lines (only neighbors touch); `all` for scatter/bubble/maps/small-multiples. */
	readonly pairs?: PairScope;
}

/**
 * Validates a categorical palette: fixed-order series colors where any two
 * may need to read apart (bars, lines, stacks — `adjacent`; scatter, bubble,
 * choropleth, small multiples — `all`).
 */
export function validate(
	palette: readonly string[],
	options: ValidateOptions = {}
): ValidationResult {
	const mode = options.mode ?? 'light';
	const surface = options.surface ?? DEFAULT_SURFACE[mode];
	const pairs = options.pairs ?? 'adjacent';
	const [lo, hi] = BAND[mode];
	const report: CheckRow[] = [];
	let ok = true;

	// 2. lightness band
	const offband = palette
		.filter((c) => {
			const L = oklch(c)[0];
			return L < lo || L > hi;
		})
		.map((c) => [c, +oklch(c)[0].toFixed(3)] as const);
	if (offband.length) ok = false;
	report.push({
		name: 'Lightness band',
		state: !offband.length,
		detail: offband.length
			? `outside band: ${JSON.stringify(offband)}`
			: `all ${palette.length} inside L ${lo}\u2013${hi}`
	});

	// 3. chroma floor
	const lowc = palette
		.filter((c) => oklch(c)[1] < CHROMA_FLOOR)
		.map((c) => [c, +oklch(c)[1].toFixed(3)] as const);
	if (lowc.length) ok = false;
	report.push({
		name: 'Chroma floor',
		state: !lowc.length,
		detail: lowc.length
			? `below floor (reads gray): ${JSON.stringify(lowc)}`
			: `all ${palette.length} >= ${CHROMA_FLOOR}`
	});

	// 4. CVD separation — adjacent for stacks/bars/lines; all pairs for scatter/bubble/maps/small-multiples
	const n = palette.length;
	const pairlist: Array<readonly [number, number]> =
		pairs === 'all'
			? Array.from({ length: n }, (_, i) =>
					Array.from({ length: n - i - 1 }, (_, k) => [i, i + 1 + k] as const)
				).flat()
			: Array.from({ length: n - 1 }, (_, i) => [i, i + 1] as const);
	const label = pairs === 'all' ? 'all-pairs' : 'adjacent';
	let worst: [number, CvdKind, string, string] | null = null;
	for (const kind of ['protan', 'deutan'] as const) {
		for (const [i, j] of pairlist) {
			const d = deltaE(palette[i], palette[j], kind);
			if (worst === null || d < worst[0]) worst = [d, kind, palette[i], palette[j]];
		}
	}
	const tri = pairlist.length
		? Math.min(...pairlist.map(([i, j]) => deltaE(palette[i], palette[j], 'tritan')))
		: 99;
	const wd = worst ? worst[0] : 99;
	const cvdState: CheckState = wd >= CVD_TARGET ? 'pass' : wd >= CVD_FLOOR ? 'floor' : 'fail';
	if (cvdState === 'fail') ok = false;
	report.push({
		name: 'CVD separation',
		state: cvdState,
		detail: worst
			? `worst ${label} ${worst[3]}\u2194${worst[2]} \u0394E ${wd.toFixed(1)} (${worst[1]}) \u00b7 tritan ${tri.toFixed(1)}`
			: 'n/a'
	});

	// 4b. Normal-vision floor — a hard gate, not excused by secondary encoding.
	let nworst: [number, string, string] | null = null;
	for (const [i, j] of pairlist) {
		const d = deltaE(palette[i], palette[j]);
		if (nworst === null || d < nworst[0]) nworst = [d, palette[i], palette[j]];
	}
	const nd = nworst ? nworst[0] : 99;
	const norState: CheckState = nd >= NORMAL_FLOOR ? 'pass' : 'fail';
	if (norState === 'fail') ok = false;
	report.push({
		name: 'Normal-vision floor',
		state: norState,
		detail: nworst
			? `worst ${label} ${nworst[2]}\u2194${nworst[1]} \u0394E ${nd.toFixed(1)} (normal)` +
				(nd >= NORMAL_FLOOR
					? ''
					: ` \u2014 below ${NORMAL_FLOOR.toFixed(0)}, hard to tell apart even with full color vision`)
			: 'n/a'
	});

	// 5. contrast vs surface — sub-3:1 is a documented conditional relax
	// (visible labels / table view), not a hard fail.
	const low = palette
		.filter((c) => contrast(c, surface) < CONTRAST_MIN)
		.map((c) => [c, +contrast(c, surface).toFixed(2)] as const);
	report.push({
		name: 'Contrast vs surface',
		state: low.length ? 'relief' : 'pass',
		detail: low.length
			? `below ${CONTRAST_MIN}:1 \u2014 relief required (visible labels or table view): ${JSON.stringify(low)}`
			: `all ${palette.length} >= ${CONTRAST_MIN}:1`
	});

	return { report, ok };
}

export interface ValidateOrdinalOptions {
	readonly mode?: Mode;
	readonly surface?: string;
}

/**
 * Validates an ordinal ramp: ordered discrete marks (certainty tiers, funnel
 * stages, size tiers) that take a one-hue lightness ramp rather than
 * categorical hues. The categorical checks FAIL a correct ramp by design (it
 * spans the lightness band and its light steps drop below the chroma floor)
 * — this is the check to run on a ramp instead.
 */
export function validateOrdinal(
	palette: readonly string[],
	options: ValidateOrdinalOptions = {}
): ValidationResult {
	const mode = options.mode ?? 'light';
	const surface = options.surface ?? DEFAULT_SURFACE[mode];
	const report: CheckRow[] = [];
	let ok = true;
	const Ls = palette.map((c) => oklch(c)[0]);

	// Monotone lightness — sorted by L must match input order (or its reverse).
	const order = [...Ls.keys()].sort((a, b) => Ls[a] - Ls[b]);
	const fwd = order.every((v, i) => v === i);
	const rev = order.every((v, i) => v === Ls.length - 1 - i);
	const mono = fwd || rev;
	if (!mono) ok = false;
	report.push({
		name: 'Lightness monotone',
		state: mono,
		detail: mono
			? 'steps read light\u2192dark'
			: `out of order \u2014 L values ${JSON.stringify(Ls.map((l) => +l.toFixed(3)))}`
	});

	// Adjacent ΔL — each step must be visibly distinct from its neighbour.
	// Filter on the raw gap, then round for display.
	const gaps = Ls.slice(1).map((l, i) => Math.abs(l - Ls[i]));
	const thin = gaps
		.map((g, i) => [palette[i], palette[i + 1], g] as const)
		.filter(([, , g]) => g < ORDINAL_MIN_DL)
		.map(([a, b, g]) => [a, b, +g.toFixed(3)] as const);
	if (thin.length) ok = false;
	report.push({
		name: 'Adjacent \u0394L',
		state: !thin.length,
		detail: thin.length
			? `steps too close: ${JSON.stringify(thin)}`
			: `all gaps >= ${ORDINAL_MIN_DL}`
	});

	// Lightest-toward-surface step vs surface — the pale end must still read as a mark.
	const byL = [...palette].sort((a, b) => oklch(a)[0] - oklch(b)[0]);
	const nearestSurface = mode === 'light' ? byL[byL.length - 1] : byL[0];
	const cr = contrast(nearestSurface, surface);
	if (cr < ORDINAL_LIGHT_FLOOR) ok = false;
	report.push({
		name: 'Nearest-surface contrast',
		state: cr >= ORDINAL_LIGHT_FLOOR,
		detail:
			`${nearestSurface} at ${cr.toFixed(2)}:1 vs surface` +
			(cr >= ORDINAL_LIGHT_FLOOR ? '' : ` \u2014 below ${ORDINAL_LIGHT_FLOOR}:1 floor`)
	});

	// Single hue — an ordinal ramp is one hue; a hue jump means it's categorical.
	const hues = palette.map(okhue);
	let spread = hues.length ? Math.max(...hues) - Math.min(...hues) : 0;
	if (spread > 180) spread = 360 - spread;
	const oneHue = spread <= 40;
	if (!oneHue) ok = false;
	report.push({
		name: 'Single hue',
		state: oneHue,
		detail:
			`hue spread ${spread.toFixed(0)}\u00b0` +
			(oneHue ? '' : ' \u2014 >40\u00b0, not a one-hue ramp')
	});

	return { report, ok };
}
