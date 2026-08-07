// Expands one raw file into the leaf documents it actually contains
// (#43): a `.zip` becomes every member it holds, recursively (a zip of
// zips, or a zip containing `.p7m` envelopes — the shape Italian bulk
// exports use — both work); a `.p7m` becomes the envelope's inner document,
// under its unwrapped name, which is itself expanded again in case that
// name still ends in `.zip`. Anything else is already a leaf.
//
// Detection is by filename extension only, deliberately: this is not an
// `InvoiceFormatAdapter` (see `$lib/server/import/adapter.ts`) deciding
// what an invoice format is, it is deciding what a *container* is, and a
// zip or a signed envelope has no content-sniffable format of its own to
// trust instead.

import { unzipSync } from 'fflate';
import { unwrapCadesEnvelope } from './pkcs7-envelope';
import type { ScannedFile } from './types';

export async function expandEntry(path: string, content: Uint8Array): Promise<ScannedFile[]> {
	if (/\.zip$/i.test(path)) {
		const members = unzipSync(content);
		const expanded: ScannedFile[][] = [];
		for (const [memberPath, memberContent] of Object.entries(members)) {
			// fflate lists directory entries with zero bytes and a trailing
			// slash; they carry nothing to import.
			if (memberPath.endsWith('/')) continue;
			expanded.push(await expandEntry(`${path}/${memberPath}`, memberContent));
		}
		return expanded.flat();
	}
	if (/\.p7m$/i.test(path)) {
		return expandEntry(path.replace(/\.p7m$/i, ''), unwrapCadesEnvelope(content));
	}
	return [{ path, content }];
}
