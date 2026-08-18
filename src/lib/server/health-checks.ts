// Backing `src/routes/health/+server.ts` (#316), which the SvelteKit route
// naming convention won't let a test import directly (`+server.test.ts`
// collides with the `+`-prefixed reserved file convention) — so the actual
// checks live here, in a plain module, and the route stays a thin wrapper
// that composes them into the JSON response.
//
// This defines what "the app is working" means operationally:
// `scripts/deploy-prod.sh`'s deploy gate and rollback trigger poll
// `/health`, so each half is checked and reported under its own key. A
// full disk or an unwritable `DOCUMENTS_DIR` would otherwise leave this
// green while document archival — invariant 4's entire foundation — is
// broken; `scripts/check-storage.ts` only catches that once, at container
// boot, and disks fill afterward.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { db } from '$lib/server/db';

export async function checkDatabase(): Promise<'ok' | 'unreachable'> {
	try {
		await db.execute(sql`select 1`);
		return 'ok';
	} catch (error) {
		console.error('health: database unreachable', error);
		return 'unreachable';
	}
}

/** Cheap and non-destructive, as this is polled on an interval by the
 * container healthcheck: one small file, written, read back and removed.
 * Never lists or sizes the directory — that would turn a sub-millisecond
 * probe into an O(files-on-disk) one as the store grows. A unique name per
 * call (rather than `scripts/check-storage.ts`'s fixed `.write-probe`) so
 * two health checks in flight at once — the container healthcheck and a
 * deploy's polling loop, say — never race each other's probe file.
 *
 * Reads `DOCUMENT_STORAGE_ROOT` from `process.env` directly rather than a
 * module-level constant, the same reason
 * `src/lib/server/repositories/document.ts`'s `storageRoot()` does: a test
 * that wants a throwaway root has to reach `process.env` itself, after
 * this module is already imported, for that to have any effect. */
export async function checkDocumentStorage(): Promise<'ok' | 'unwritable'> {
	const root = process.env.DOCUMENT_STORAGE_ROOT ?? './data/documents';
	const probe = join(root, `.health-${process.pid}-${randomUUID()}`);
	const contents = `mastro-health-${randomUUID()}`;
	try {
		await mkdir(root, { recursive: true, mode: 0o700 });
		await writeFile(probe, contents, { mode: 0o600 });
		const readBack = await readFile(probe, 'utf8');
		if (readBack !== contents) throw new Error('read-back did not match what was written');
		return 'ok';
	} catch (error) {
		console.error('health: document storage unwritable', error);
		return 'unwritable';
	} finally {
		// Best-effort: `force: true` only swallows ENOENT (the probe was
		// never created), not e.g. ENOTDIR (a component of `root` isn't a
		// directory at all) — the failure the unwritable-store case above
		// exists to catch, and the whole reason this is its own try/catch
		// rather than folded into the one above it.
		await rm(probe, { force: true }).catch(() => {});
	}
}
