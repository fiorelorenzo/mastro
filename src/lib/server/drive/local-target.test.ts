import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { createLocalDirectoryMirrorTarget } from './local-target';

let root: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'mastro-drive-local-target-'));
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

test('publishing creates the configured folder structure and writes the bytes', async () => {
	const target = createLocalDirectoryMirrorTarget(root);
	const bytes = new TextEncoder().encode('a signed contract');

	const result = await target.publish({
		documentId: 'doc-1',
		bytes,
		mime: 'application/pdf',
		fileName: 'contract.pdf',
		folder: { segments: ['Contracts', 'Acme SRL'] }
	});

	const written = await readFile(join(root, 'Contracts', 'Acme SRL', 'doc-1__contract.pdf'));
	expect(Buffer.compare(written, Buffer.from(bytes))).toBe(0);
	expect(result.remoteFileId).toBe(join('Contracts', 'Acme SRL', 'doc-1__contract.pdf'));
});

test('two documents with the same original name in the same folder do not collide', async () => {
	const target = createLocalDirectoryMirrorTarget(root);
	const folder = { segments: ['Contracts', 'Acme SRL'] };

	await target.publish({
		documentId: 'doc-1',
		bytes: new TextEncoder().encode('first version'),
		mime: 'application/pdf',
		fileName: 'contract.pdf',
		folder
	});
	await target.publish({
		documentId: 'doc-2',
		bytes: new TextEncoder().encode('second version'),
		mime: 'application/pdf',
		fileName: 'contract.pdf',
		folder
	});

	const entries = await readdir(join(root, 'Contracts', 'Acme SRL'));
	expect(entries.sort()).toEqual(['doc-1__contract.pdf', 'doc-2__contract.pdf']);
});

test('nested folder segments are created even when nothing exists yet', async () => {
	const target = createLocalDirectoryMirrorTarget(root);

	await target.publish({
		documentId: 'doc-3',
		bytes: new TextEncoder().encode('x'),
		mime: 'text/plain',
		fileName: 'note.txt',
		folder: { segments: ['Contracts', 'Beta SpA'] }
	});

	const entries = await readdir(join(root, 'Contracts'));
	expect(entries).toEqual(['Beta SpA']);
});
