import { expect, test } from 'vitest';
import { readMirrorFolderConfig, resolveMirrorFolder } from './folder';

test('an unset DRIVE_MIRROR_CONTRACTS_FOLDER falls back to "Contracts"', () => {
	expect(readMirrorFolderConfig({})).toEqual({ contractsFolderName: 'Contracts' });
});

test('a configured folder name is trimmed and used verbatim', () => {
	expect(readMirrorFolderConfig({ DRIVE_MIRROR_CONTRACTS_FOLDER: '  Contratti  ' })).toEqual({
		contractsFolderName: 'Contratti'
	});
});

test('a blank DRIVE_MIRROR_CONTRACTS_FOLDER falls back to the default rather than publishing into an unnamed folder', () => {
	expect(readMirrorFolderConfig({ DRIVE_MIRROR_CONTRACTS_FOLDER: '   ' })).toEqual({
		contractsFolderName: 'Contracts'
	});
});

test('a client-scoped document resolves to /<contracts folder>/<client legal name>/', () => {
	const folder = resolveMirrorFolder(
		{ clientLegalName: 'Acme SRL' },
		{ contractsFolderName: 'Contracts' }
	);
	expect(folder).toEqual({ segments: ['Contracts', 'Acme SRL'] });
});

test('the configured folder name replaces the default segment, not just the client one', () => {
	const folder = resolveMirrorFolder(
		{ clientLegalName: 'Acme SRL' },
		{ contractsFolderName: 'Contratti' }
	);
	expect(folder.segments[0]).toBe('Contratti');
});
