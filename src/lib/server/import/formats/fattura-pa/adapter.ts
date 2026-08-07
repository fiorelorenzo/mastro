// The FatturaPA 1.2 adapter (#42): the first concrete `InvoiceFormatAdapter`
// (#41). `id` is `'FPR12'`, the FatturaPA transmission-format code for an
// invoice addressed to a private party (as opposed to `FPA12`, addressed
// to a Public Administration) — a consultant billing private clients
// always transmits under this code, so it is also the value a jurisdiction
// pack lists in `formats` to advertise support for it (see `registry.ts`
// in `fiscal/` for where `it-flat-rate`/`it-standard` do that).

import type { ImportableFile, InvoiceFormatAdapter } from '../../adapter';
import type { Invoice } from '../../invoice';
import { mapFatturaPaToInvoices } from './map';
import { tryParseFatturaElettronica } from './xml';

const FORMAT_ID = 'FPR12';

function decodeUtf8(content: Uint8Array): string | null {
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(content);
	} catch {
		return null;
	}
}

function detect(file: ImportableFile): boolean {
	// `detect` must be total (see the interface contract in `../../adapter.ts`):
	// wrap the whole thing, not just XML parsing, so a bug in a dependency
	// on unexpected bytes still comes back `false` rather than crashing a
	// scan of many candidate files.
	try {
		const xml = decodeUtf8(file.content);
		if (xml === null) return false;
		const root = tryParseFatturaElettronica(xml);
		if (root === null) return false;
		return (
			root['@_versione'] === FORMAT_ID &&
			root.FatturaElettronicaHeader.DatiTrasmissione.FormatoTrasmissione === FORMAT_ID
		);
	} catch {
		return false;
	}
}

function parse(file: ImportableFile): readonly Invoice[] {
	const xml = decodeUtf8(file.content);
	if (xml === null) throw new Error(`${file.filename} is not valid UTF-8 text`);
	const root = tryParseFatturaElettronica(xml);
	if (root === null)
		throw new Error(`${file.filename} is not a well-formed FatturaElettronica document`);
	return mapFatturaPaToInvoices(root);
}

export const fatturaPaAdapter: InvoiceFormatAdapter = { id: FORMAT_ID, detect, parse };
