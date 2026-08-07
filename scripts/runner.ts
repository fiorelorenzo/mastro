// The ACP runner's plain-node entrypoint (#82) — `node scripts/runner.ts
// [watch|once|enqueue ...]`, no build step and no dev dependency, the same
// reason scripts/migrate.ts and scripts/record-backup-run.ts are plain
// node too. All the actual logic lives in
// src/lib/server/runner/cli.ts; this file only calls it. Unlike those two
// scripts, the module it imports has its own internal relative imports —
// every one of them carries an explicit `.ts` extension
// (`./db.ts`, not `./db`), which is what lets this run under plain node's
// ESM loader without a bundler: an extensionless relative specifier does
// not resolve there (see scripts/record-backup-run.ts's own comment for
// the general rule this works around).
import { runRunnerCli } from '../src/lib/server/runner/cli.ts';

await runRunnerCli(process.argv.slice(2));
