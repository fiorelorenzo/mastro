// #35: AGENTS.md invariant 1 ("no country-specific logic outside a
// jurisdiction pack"), made executable across the whole product, not just
// the two files engine.test.ts already names. That test proves pack.ts and
// resolve.ts stay clean; this one proves everything else does too.
//
// The scan is intentionally narrow rather than clever: it flags a small set
// of shapes verified (below, and by this file's own tests) to have exactly
// two legitimate homes today — src/lib/server/fiscal/packs/ and the
// invoice format adapters under src/lib/server/import/formats/ — and
// nowhere else. It does not try to parse an AST or understand "logic": a country
// identifier, a national scheme name or a statutory figure has no business
// appearing as a literal outside a pack at all, whether it is inside an
// `if` or just sitting in an object. Exempt: the packs directory itself
// (where these things are supposed to live), every test file (fixtures
// legitimately use a client's own country, e.g. `country: 'IT'`, which is
// data about a client, not logic about mastro's own jurisdiction — see
// contract.test.ts), and the generated `paraglide` output (compiled from
// messages/*.json, the interface language, not country logic).

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

// This file lives at src/lib/server/fiscal/, three levels below src/.
const SRC_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const EXEMPT_DIR_NAMES: Record<string, true> = {
	node_modules: true,
	'.svelte-kit': true,
	// Generated from messages/*.json by paraglide-js — the interface
	// language, not country logic (see AGENTS.md's i18n section).
	paraglide: true,
	// Where every one of these things is supposed to live.
	packs: true,
	// The other sanctioned home. An invoice format adapter is a national
	// concept by definition (#41: "keep every national concept inside the
	// adapter", so adding a country is adding an adapter rather than
	// editing the importer), exactly as a pack is. The importer itself is
	// scanned, and naming a format there would still fail.
	formats: true,
	// `demo-seed.ts` (#226): a client's own country/region and a free-text
	// `contract.taxTreatment` label a real client typed in are data about
	// that client, not logic about mastro's own jurisdiction — the exact
	// distinction this file's own header comment draws for `.test.ts`
	// fixtures (`contract.test.ts`'s `country: 'IT'`), just outside a test
	// file this time. Nothing under `fiscal/` is exempt: a seed choosing
	// the active pack still does that by id (`itFlatRatePack.id`), never a
	// literal, so this exemption never hides a real jurisdiction branch.
	seed: true
};

// .ts files are scanned whole, .svelte files only through their <script>
// block (extractScannableSource, below): template markup is full of
// hyphenated two-letter-prefixed class names (Tailwind's `sr-only` is
// exactly `[a-z]{2}-[a-z]+`, and matched here before this line existed),
// which would swamp the pack-id-shaped and country-code patterns below
// with false positives. Restricting .svelte to its script content keeps
// that false-positive reason addressed without leaving a literal
// comparison written directly inside a route's <script> block unscanned
// (#325) the way excluding the extension outright used to.
const SOURCE_EXTENSIONS = ['.ts', '.svelte'];

/** Every non-test source file under `root`, skipping the directories and
 * files this invariant does not apply to. */
function listScannedFiles(root: string, dir: string = root, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		if (EXEMPT_DIR_NAMES[entry]) continue;
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			listScannedFiles(root, full, out);
			continue;
		}
		const isSource = SOURCE_EXTENSIONS.some((ext) => entry.endsWith(ext));
		const isTest = entry.endsWith('.test.ts') || entry.endsWith('.spec.ts');
		if (isSource && !isTest) out.push(full);
	}
	return out;
}

interface Rule {
	readonly what: string;
	readonly pattern: RegExp;
	/** Literals of this shape that are provably not what the rule is hunting. */
	readonly allow?: ReadonlySet<string>;
}

// Each pattern targets a specific literal shape checked (see this file's
// own tests, and the grep run recorded in the PR description) to have zero
// occurrences in today's tree outside packs/ and tests — not "any short
// string" or "any round number", which would misfire constantly.
/**
 * A handful of literals share the pack-id shape and are demonstrably not
 * pack ids: IANA charset names in a MIME header parser, for one, and the
 * HTTP cache directives an SSE route has to send, where the collision is
 * `no` being Norway. They are listed rather than pattern-excused, so
 * adding one is a decision somebody reads, and so a real pack id can
 * never hide behind a loosened regex.
 */
const NOT_PACK_IDS = new Set([
	"'us-ascii'",
	'"us-ascii"',
	"'no-cache'",
	'"no-cache"',
	"'no-store'",
	'"no-store"'
]);

const RULES: readonly Rule[] = [
	{
		what: "a pack-id-shaped literal ('<country>-<regime>', e.g. 'it-flat-rate')",
		pattern: /['"][a-z]{2}-[a-z][a-z-]*['"]/g,
		allow: NOT_PACK_IDS
	},
	{
		what: "a quoted ISO 3166-1 alpha-2 country code (e.g. 'IT')",
		pattern: /['"][A-Z]{2}['"]/
	},
	{
		what: "a national scheme name ('regime forfettario')",
		pattern: /regime forfettario|forfettario/i
	},
	{
		what: 'the it-flat-rate revenue ceilings (#33), in euros or cents',
		pattern: /\b(85000|8500000|100000|10000000)\b/
	},
	{
		what: 'the it-flat-rate stamp-duty threshold (#33), 77.47 EUR',
		pattern: /\b(7747|77[.,]47)\b/
	}
];

interface Violation {
	readonly file: string;
	readonly what: string;
	readonly match: string;
}

function findViolations(source: string, file: string): Violation[] {
	const violations: Violation[] = [];
	for (const rule of RULES) {
		// A global pattern is matched exhaustively so one allowed literal
		// cannot mask a real violation later in the same file.
		const matches = rule.pattern.global
			? [...source.matchAll(rule.pattern)].map((m) => m[0])
			: [source.match(rule.pattern)?.[0]].filter((m): m is string => m !== undefined);
		for (const match of matches) {
			if (rule.allow?.has(match)) continue;
			violations.push({ file, what: rule.what, match });
			break;
		}
	}
	return violations;
}

/** For a `.svelte` file, only the content of its `<script>` block(s) is
 * scannable — template markup is deliberately excluded (see
 * SOURCE_EXTENSIONS above). Every `<script>` tag, including a module-context
 * one, is concatenated; any other file is returned unchanged. */
function extractScannableSource(source: string, file: string): string {
	if (!file.endsWith('.svelte')) return source;
	const blocks = [...source.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
	return blocks.map((block) => block[1]).join('\n');
}

describe('the detector itself', () => {
	test("catches the acceptance example, if (country === 'IT'), verbatim", () => {
		const violations = findViolations("if (country === 'IT') { applyItalianRules(); }", 'x.ts');
		expect(violations.map((v) => v.match)).toContain("'IT'");
	});

	test('catches a pack id smuggled into a branch', () => {
		const violations = findViolations("if (pack.id === 'it-flat-rate') { ... }", 'x.ts');
		expect(violations.map((v) => v.match)).toContain("'it-flat-rate'");
	});

	test('lets an IANA charset through, and still catches a pack id in the same file', () => {
		// The charset map in the MIME header parser holds 'us-ascii', which
		// has the pack-id shape and is not one. Allowing it must not blind
		// the rule to a real pack id sitting a few lines below.
		const charsetOnly = findViolations("const charsets = { 'us-ascii': 'ascii' };", 'x.ts');
		expect(charsetOnly).toEqual([]);

		const both = findViolations(
			"const charsets = { 'us-ascii': 'ascii' };\nif (pack.id === 'it-flat-rate') { ... }",
			'x.ts'
		);
		expect(both.map((v) => v.match)).toContain("'it-flat-rate'");
	});

	test('catches the national scheme name written out in prose', () => {
		const violations = findViolations('// special-cased for the regime forfettario', 'x.ts');
		expect(violations).not.toEqual([]);
	});

	test('catches this issue’s own ceiling figures, in euros or in cents', () => {
		expect(findViolations('if (revenue > 85000)', 'x.ts')).not.toEqual([]);
		expect(findViolations('const ceiling = 10000000;', 'x.ts')).not.toEqual([]);
	});

	test('catches the stamp-duty threshold spelled either way', () => {
		expect(findViolations('appliesWhen: total > 7747', 'x.ts')).not.toEqual([]);
		expect(findViolations('// above 77,47 euro', 'x.ts')).not.toEqual([]);
	});

	test('does not flag ordinary code with no jurisdiction content', () => {
		expect(findViolations('const upper = a.toUpperCase();', 'x.ts')).toEqual([]);
		expect(
			findViolations('export function total(a: number, b: number) { return a + b; }', 'x.ts')
		).toEqual([]);
	});

	test('scans a .svelte file’s <script> block and flags a planted country check there (#325)', () => {
		const svelteSource = [
			'<script lang="ts">',
			"  if (client.country === 'IT') applyItalianRules();",
			'</script>',
			'',
			'<div class="sr-only">note</div>'
		].join('\n');
		const violations = findViolations(extractScannableSource(svelteSource, 'x.svelte'), 'x.svelte');
		expect(violations.map((v) => v.match)).toContain("'IT'");
	});

	test('does not flag markup-only hyphenated two-letter class names in a .svelte template', () => {
		const svelteSource = [
			'<script lang="ts">',
			'  const upper = a.toUpperCase();',
			'</script>',
			'',
			'<div class="sr-only no-scroll text-sm">note</div>'
		].join('\n');
		const violations = findViolations(extractScannableSource(svelteSource, 'x.svelte'), 'x.svelte');
		expect(violations).toEqual([]);
	});
});

describe('the shipped tree', () => {
	const files = listScannedFiles(SRC_ROOT);

	test('the two sanctioned homes and every test file are excluded from the scan', () => {
		expect(files.some((f) => f.includes(join('fiscal', 'packs') + '/'))).toBe(false);
		expect(files.some((f) => f.includes(join('import', 'formats') + '/'))).toBe(false);
		expect(files.some((f) => f.endsWith('.test.ts') || f.endsWith('.spec.ts'))).toBe(false);
	});

	test('the importer itself is still scanned, so naming a format there fails', () => {
		expect(files.some((f) => f.endsWith(join('import', 'importer.ts')))).toBe(true);
	});

	test('.svelte files are part of the scanned set (#325)', () => {
		expect(files.some((f) => f.endsWith('.svelte'))).toBe(true);
	});

	test('the packs themselves do contain the flagged shapes — the rules are not vacuous', () => {
		const packsDir = join(SRC_ROOT, 'lib', 'server', 'fiscal', 'packs');
		const packSource = readdirSync(packsDir)
			.filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
			.map((f) => readFileSync(join(packsDir, f), 'utf8'))
			.join('\n');
		const violations = findViolations(packSource, 'packs');
		expect(violations.length).toBeGreaterThan(0);
	});

	test('no country identifier, national scheme name or hardcoded statutory figure appears outside a pack or a format adapter, in a .ts file or a .svelte <script> block', () => {
		const violations = files.flatMap((file) =>
			findViolations(extractScannableSource(readFileSync(file, 'utf8'), file), file)
		);
		const report = violations
			.map(
				(v) =>
					`${v.file}: found ${v.what} (${JSON.stringify(v.match)}).\n` +
					'  This belongs in a jurisdiction pack under src/lib/server/fiscal/packs/, or, ' +
					'if it is a detail of a national invoice format, inside that format adapter ' +
					'under src/lib/server/import/formats/. If neither can express what you need, ' +
					'extend FiscalPack in src/lib/server/fiscal/pack.ts or the adapter interface in ' +
					'src/lib/server/import/adapter.ts, instead of branching on a country here ' +
					'(AGENTS.md invariant 1).'
			)
			.join('\n\n');
		expect(violations, report).toEqual([]);
	});
});
