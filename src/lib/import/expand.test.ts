// #43. `expandEntry` is the pure recursion at the heart of the folder
// scan: a `.zip` expands to its members, a `.p7m` expands to its unwrapped
// content, and both recurse (a zip of `.p7m` files, a `.p7m` wrapping a
// zip) — everything else is already a leaf.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { zipSync } from 'fflate';
import { describe, expect, test } from 'vitest';
import { expandEntry } from './expand';

const FIXTURE_ROOT = join(import.meta.dirname, 'fixtures/scan-tree');
const encoder = new TextEncoder();

describe('expandEntry', () => {
	test('a plain file is its own single leaf', async () => {
		const content = encoder.encode('plain text');
		await expect(expandEntry('readme.txt', content)).resolves.toEqual([
			{ path: 'readme.txt', content }
		]);
	});

	test('a zip expands to one leaf per member, path-prefixed for diagnostics', async () => {
		const zipBytes = zipSync({
			'a.txt': encoder.encode('file a'),
			'sub/b.txt': encoder.encode('file b')
		});
		const result = await expandEntry('archive.zip', zipBytes);
		expect(result.map((f) => f.path).toSorted()).toEqual([
			'archive.zip/a.txt',
			'archive.zip/sub/b.txt'
		]);
		expect(new TextDecoder().decode(result.find((f) => f.path.endsWith('a.txt'))!.content)).toBe(
			'file a'
		);
	});

	test('a zip of zips recurses fully', async () => {
		const innerZip = zipSync({ 'inner.txt': encoder.encode('nested content') });
		const outerZip = zipSync({ 'inner.zip': innerZip });
		const result = await expandEntry('outer.zip', outerZip);
		expect(result).toEqual([
			{ path: 'outer.zip/inner.zip/inner.txt', content: encoder.encode('nested content') }
		]);
	});

	test('a zip containing a signed envelope unwraps the envelope too', async () => {
		const envelope = readFileSync(join(FIXTURE_ROOT, 'envelope.xml.p7m'));
		const zipBytes = zipSync({ 'invoice.xml.p7m': new Uint8Array(envelope) });
		const result = await expandEntry('bundle.zip', zipBytes);
		expect(result).toHaveLength(1);
		expect(result[0].path).toBe('bundle.zip/invoice.xml');
		expect(new TextDecoder().decode(result[0].content)).toContain('<Fixture>');
	});

	test('a signed envelope unwraps to its inner document, named without .p7m', async () => {
		const envelope = readFileSync(join(FIXTURE_ROOT, 'envelope.xml.p7m'));
		const result = await expandEntry('invoice.xml.p7m', new Uint8Array(envelope));
		expect(result).toHaveLength(1);
		expect(result[0].path).toBe('invoice.xml');
		expect(new TextDecoder().decode(result[0].content)).toContain('<Fixture>');
	});

	test('extension matching on .zip and .p7m is case-insensitive', async () => {
		const envelope = readFileSync(join(FIXTURE_ROOT, 'envelope.xml.p7m'));
		const result = await expandEntry('INVOICE.XML.P7M', new Uint8Array(envelope));
		expect(result[0].path).toBe('INVOICE.XML');
	});

	test('a malformed signed envelope throws rather than yielding garbage', async () => {
		await expect(expandEntry('broken.xml.p7m', encoder.encode('not a p7m'))).rejects.toThrow();
	});
});
