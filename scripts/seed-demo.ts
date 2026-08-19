// Builds the demo instance the mockup depicts (#226) — `pnpm seed:demo` on
// an already-migrated database. Runs under plain `node` (type stripping),
// no build step and no dev dependency, the same reason `scripts/migrate.ts`
// and `scripts/runner.ts` are plain node too.
//
// All the actual logic lives in `src/lib/server/seed/demo-seed.ts`, which
// `pnpm check` type-checks the same way it does every other file under
// `src/lib/server` (see that file's own header for why the split exists).
// This entrypoint's only job beyond calling it is registering
// `seed-lib-resolve.ts` — the loader hook that lets a `$lib`-aliased,
// extensionless-relative-import module graph load under plain Node's ESM
// resolver at all (see that file for the full explanation) — *before* any
// of that graph is reached. It has to happen first: a static top-level
// import of a `$lib`-aliased module right here, before `register()` runs,
// would already have failed to resolve by the time this file's own body
// starts executing. `seedDemo` is therefore reached through a dynamic
// `import()`, the one legitimate case for one in this codebase — the
// specifier is fixed, but it has to load after the hook is live, and
// there is no other way to sequence that under plain ESM.
import { register } from 'node:module';
import { log } from '../src/lib/server/log/logger.ts';

register('./seed-lib-resolve.ts', import.meta.url);

const { seedDemo } = await import('../src/lib/server/seed/demo-seed.ts');
const { client: pool } = await import('$lib/server/db');

try {
	const result = await seedDemo();
	log.info(
		result.alreadySeeded
			? 'demo instance already present (a fiscal profile is on record) — nothing written'
			: 'demo instance seeded: Nordwind Logistics, Bellani & Partners, Fermata Digitale'
	);
} finally {
	await pool.end();
}
