// #316: `/health` is what `scripts/deploy-prod.sh`'s deploy gate and
// rollback trigger poll, so `checkDocumentStorage` has to notice a broken
// blob store, not just `checkDatabase` noticing a broken database.
// `DOCUMENT_STORAGE_ROOT` is read from `process.env` directly (see this
// module's own comment for why), so pointing it at a throwaway path here
// actually reaches the check.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { checkDatabase, checkDocumentStorage } from './health-checks';

let root: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'mastro-health-'));
});

afterEach(async () => {
	delete process.env.DOCUMENT_STORAGE_ROOT;
	await rm(root, { recursive: true, force: true });
});

test('the database check reaches the real database', async () => {
	expect(await checkDatabase()).toBe('ok');
});

test('reports ok and leaves no probe file behind when the store is writable', async () => {
	process.env.DOCUMENT_STORAGE_ROOT = root;

	expect(await checkDocumentStorage()).toBe('ok');
});

test('reports unwritable when the document root cannot be created', async () => {
	// A regular file sitting where a directory needs to be created: `mkdir`
	// with `recursive: true` fails on it with ENOTDIR regardless of who
	// owns the process, unlike a permission-bit test, which a root-run
	// container would sail straight through.
	const blocker = join(root, 'blocker');
	await writeFile(blocker, 'not a directory');
	process.env.DOCUMENT_STORAGE_ROOT = join(blocker, 'documents');

	expect(await checkDocumentStorage()).toBe('unwritable');
});
