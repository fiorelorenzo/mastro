// #43, acceptance: "A nested folder tree containing a zip of documents is
// fully traversed", "a signed envelope yields its inner document", and "a
// large folder reports progress rather than appearing to hang".
//
// `scanDirectoryHandle` takes a `ScanDirectoryHandle` — the same minimal
// shape a real `FileSystemDirectoryHandle` satisfies (see scan-source.ts) —
// so this test walks a real, checked-in fixture tree
// (fixtures/scan-tree/) with a small Node-`fs` adapter instead of a
// browser, exercising the exact recursion, zip expansion and envelope
// unwrapping the browser code path runs.
import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { zipSync } from 'fflate';
import { describe, expect, test } from 'vitest';
import { scanDirectoryHandle, scanFileList } from './scan';
import type { ScanDirectoryHandle, ScanFile } from './scan';

const FIXTURE_ROOT = join(import.meta.dirname, 'fixtures/scan-tree');

function nodeDirectoryHandle(root: string): ScanDirectoryHandle {
	return {
		kind: 'directory',
		name: basename(root),
		async *values() {
			const entries = await readdir(root, { withFileTypes: true });
			for (const entry of entries) {
				const full = join(root, entry.name);
				if (entry.isDirectory()) {
					yield nodeDirectoryHandle(full);
				} else {
					yield {
						kind: 'file' as const,
						name: entry.name,
						async getFile() {
							const buffer = await readFile(full);
							return { arrayBuffer: async () => new Uint8Array(buffer).buffer };
						}
					};
				}
			}
		}
	};
}

describe('scanDirectoryHandle over a real fixture tree', () => {
	test('walks nested folders, expands the zip and unwraps the signed envelope', async () => {
		const files = await scanDirectoryHandle(nodeDirectoryHandle(FIXTURE_ROOT));
		expect(files.map((f) => f.path).toSorted()).toEqual([
			'archive.zip/inside/a.txt',
			'archive.zip/inside/b.txt',
			'envelope.xml',
			'nested/deeper/more.txt',
			'nested/notes.txt',
			'readme.txt'
		]);
		expect(new TextDecoder().decode(files.find((f) => f.path === 'envelope.xml')!.content)).toBe(
			'<Fixture>Synthetic document wrapped in a CAdES envelope for the folder-scan test (#43).</Fixture>\n'
		);
	});

	test('reports progress as it goes rather than only at the end', async () => {
		const snapshots: { filesVisited: number; filesProduced: number }[] = [];
		await scanDirectoryHandle(nodeDirectoryHandle(FIXTURE_ROOT), (progress) =>
			snapshots.push(progress)
		);
		// One raw file per callback (5 files on disk: readme, 2 nested, the
		// zip, the envelope), each strictly further along than the last, and
		// the zip's callback jumps `filesProduced` by more than one since it
		// expanded to two members in a single visit.
		expect(snapshots).toHaveLength(5);
		for (let i = 1; i < snapshots.length; i++) {
			expect(snapshots[i].filesVisited).toBe(snapshots[i - 1].filesVisited + 1);
			expect(snapshots[i].filesProduced).toBeGreaterThan(snapshots[i - 1].filesProduced);
		}
		expect(snapshots.at(-1)).toEqual({ filesVisited: 5, filesProduced: 6 });
	});

	test('a large folder keeps reporting progress throughout, not just once', async () => {
		const fileCount = 250;
		const root: ScanDirectoryHandle = {
			kind: 'directory',
			name: 'big',
			async *values() {
				for (let i = 0; i < fileCount; i++) {
					yield {
						kind: 'file' as const,
						name: `file-${i}.txt`,
						async getFile() {
							return { arrayBuffer: async () => new TextEncoder().encode(`content ${i}`).buffer };
						}
					};
				}
			}
		};
		const progressCalls: number[] = [];
		const files = await scanDirectoryHandle(root, (progress) =>
			progressCalls.push(progress.filesVisited)
		);
		expect(files).toHaveLength(fileCount);
		expect(progressCalls).toHaveLength(fileCount);
		expect(progressCalls).toEqual(Array.from({ length: fileCount }, (_, i) => i + 1));
	});
});

describe('scanFileList (the <input webkitdirectory> fallback)', () => {
	function fakeFile(webkitRelativePath: string, text: string): ScanFile {
		return {
			name: webkitRelativePath.split('/').at(-1) ?? webkitRelativePath,
			webkitRelativePath,
			arrayBuffer: async () => new TextEncoder().encode(text).buffer
		};
	}

	test('walks a flat FileList using each entry\u2019s own relative path', async () => {
		const files = await scanFileList([
			fakeFile('mastro/readme.txt', 'hello'),
			fakeFile('mastro/nested/notes.txt', 'world')
		]);
		expect(files).toEqual([
			{ path: 'mastro/readme.txt', content: new TextEncoder().encode('hello') },
			{ path: 'mastro/nested/notes.txt', content: new TextEncoder().encode('world') }
		]);
	});

	test('still expands a zip picked up through the fallback input', async () => {
		const zipBytes = zipSync({ 'a.txt': new TextEncoder().encode('zipped') });
		const files = await scanFileList([
			{
				name: 'archive.zip',
				webkitRelativePath: 'mastro/archive.zip',
				arrayBuffer: async () => zipBytes.buffer as ArrayBuffer
			}
		]);
		expect(files).toEqual([
			{ path: 'mastro/archive.zip/a.txt', content: new TextEncoder().encode('zipped') }
		]);
	});
});
