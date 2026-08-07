import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { blobPath, hashContent, readBlob, writeBlob } from './blob-store';

let root: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'mastro-blob-store-'));
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

test('the same bytes hash the same way every time', () => {
	const bytes = new TextEncoder().encode('a contract, signed');
	expect(hashContent(bytes)).toBe(hashContent(bytes));
	expect(hashContent(bytes)).toMatch(/^[0-9a-f]{64}$/);
});

test('a freshly written blob and its shard directories get an explicit restrictive mode, not the process umask', async () => {
	// Simulate the most permissive umask a self-hoster's host could hand
	// this process (#114's own worst case) — 0 masks nothing at all, so
	// if `writeBlob` ever fell back to Node's default (0o666 for files,
	// 0o777 for directories) this would catch it. Restored in `finally`
	// so a failure here cannot leak a permissive umask into another test.
	const previousUmask = process.umask(0o000);
	let bytes: { hash: string };
	try {
		bytes = await writeBlob(root, new TextEncoder().encode('a signed contract'));
	} finally {
		process.umask(previousUmask);
	}

	const filePath = blobPath(root, bytes.hash);
	const fileMode = (await stat(filePath)).mode & 0o777;
	expect(fileMode).toBe(0o600);

	const shardDir = join(root, bytes.hash.slice(0, 2), bytes.hash.slice(2, 4));
	const dirMode = (await stat(shardDir)).mode & 0o777;
	expect(dirMode).toBe(0o700);
});

test('different bytes hash differently', () => {
	const a = new TextEncoder().encode('version one');
	const b = new TextEncoder().encode('version two');
	expect(hashContent(a)).not.toBe(hashContent(b));
});

test('writing the same content twice leaves exactly one file on disk', async () => {
	const bytes = new TextEncoder().encode('the archived original');

	const first = await writeBlob(root, bytes);
	const second = await writeBlob(root, bytes);

	expect(first.hash).toBe(second.hash);
	expect(first.size).toBe(bytes.byteLength);

	const shardDir = join(root, first.hash.slice(0, 2), first.hash.slice(2, 4));
	const entries = await readdir(shardDir);
	expect(entries).toEqual([first.hash]);
});

test('a written blob reads back byte for byte', async () => {
	const bytes = new TextEncoder().encode('what the client actually sent');
	const { hash } = await writeBlob(root, bytes);
	const readBack = await readBlob(root, hash);
	expect(Buffer.compare(readBack, Buffer.from(bytes))).toBe(0);
});

test('the path shards on the first two byte-pairs of the hash', () => {
	const hash = 'ab'.padEnd(64, '0');
	expect(blobPath(root, hash)).toBe(join(root, 'ab', '00', hash));
});
