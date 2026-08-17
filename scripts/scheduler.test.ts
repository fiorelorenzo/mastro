// Guards the exact drift AGENTS.md records: `/api/agent/run` answered 500
// on every scheduler tick for a whole release while every local command
// stayed green, because nothing but the scheduler ever requested it.
// `.github/workflows/ci.yml`'s `image` job POSTs a hand-written list of
// the routes `scripts/scheduler.ts` calls on a timer. This test parses
// both lists instead of maintaining a third one: it fails, naming the
// missing route, the moment either file adds a route the other does not
// know about.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const schedulerSource = readFileSync(
	fileURLToPath(new URL('./scheduler.ts', import.meta.url)),
	'utf8'
);
const ciSource = readFileSync(
	fileURLToPath(new URL('../.github/workflows/ci.yml', import.meta.url)),
	'utf8'
);

/**
 * The routes the `image` job's "Boot it and check /health" step POSTs,
 * reconstructed from its `for job in ...; do ... "http://.../api/$job"`
 * shape the same way the shell loop itself does.
 */
function ciRoutes(source: string): string[] {
	const match = source.match(/for job in ([^;]+); do[\s\S]*?"http:\/\/[^"]*\/api\/\$job"/);
	if (!match) {
		throw new Error('could not find the `for job in ...; do ... /api/$job` sweep in ci.yml');
	}
	return match[1]
		.trim()
		.split(/\s+/)
		.map((job) => `/api/${job}`);
}

test('every route scripts/scheduler.ts calls on a timer is POSTed by the image job in ci.yml, and vice versa', () => {
	const scheduled = [...schedulerSource.matchAll(/path:\s*'(\/api\/[^']+)'/g)].map((m) => m[1]);
	const exercised = ciRoutes(ciSource);

	expect(scheduled.length).toBeGreaterThan(0);
	expect(exercised.length).toBeGreaterThan(0);

	const missingFromCi = scheduled.filter((route) => !exercised.includes(route));
	const missingFromScheduler = exercised.filter((route) => !scheduled.includes(route));

	expect(missingFromCi, "scheduled route(s) never POSTed by ci.yml's image job").toEqual([]);
	expect(missingFromScheduler, 'ci.yml POSTs route(s) scripts/scheduler.ts never calls').toEqual(
		[]
	);
});
