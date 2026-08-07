// #43. Builds a minimal DER-encoded CMS SignedData envelope by hand — the
// same shape `openssl smime -sign -nodetach -outform DER` produces, minus a
// real certificate chain, which `unwrapCadesEnvelope` never looks at (see
// the module comment) — so the fixture below is a faithful stand-in for a
// real `.p7m` for what this file is testing.
import { describe, expect, test } from 'vitest';
import { unwrapCadesEnvelope } from './pkcs7-envelope';

function derLength(n: number): number[] {
	if (n < 0x80) return [n];
	const bytes: number[] = [];
	let value = n;
	while (value > 0) {
		bytes.unshift(value & 0xff);
		value >>= 8;
	}
	return [0x80 | bytes.length, ...bytes];
}

function tlv(tag: number, content: Uint8Array): Uint8Array {
	return Uint8Array.from([tag, ...derLength(content.length), ...content]);
}

function concat(parts: Uint8Array[]): Uint8Array {
	const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}

const OID_DATA = Uint8Array.from([
	0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x01
]);
const OID_SIGNED_DATA = Uint8Array.from([
	0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02
]);
const OID_ENVELOPED_DATA = Uint8Array.from([
	0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x03
]);

/** Builds a CMS `ContentInfo` of type `signedData` wrapping `payload` as
 * its `eContent`, either as one primitive OCTET STRING or, when `chunkSize`
 * is given, as a constructed OCTET STRING of several primitive chunks —
 * both are legal DER, and real signers use the chunked form for large
 * documents. */
function buildSignedEnvelope(payload: Uint8Array, chunkSize?: number): Uint8Array {
	const octetString = chunkSize
		? tlv(
				0x24,
				concat(
					Array.from({ length: Math.ceil(payload.length / chunkSize) }, (_, i) =>
						tlv(0x04, payload.slice(i * chunkSize, (i + 1) * chunkSize))
					)
				)
			)
		: tlv(0x04, payload);
	const eContent = tlv(0xa0, octetString);
	const encapContentInfo = tlv(0x30, concat([OID_DATA, eContent]));
	const version = tlv(0x02, Uint8Array.from([0x01]));
	const emptySet = tlv(0x31, new Uint8Array(0));
	const signedData = tlv(0x30, concat([version, emptySet, encapContentInfo, emptySet]));
	const explicitContent = tlv(0xa0, signedData);
	return tlv(0x30, concat([OID_SIGNED_DATA, explicitContent]));
}

describe('unwrapCadesEnvelope', () => {
	test('extracts the eContent of a single-chunk envelope', () => {
		const payload = new TextEncoder().encode('the original document');
		expect(unwrapCadesEnvelope(buildSignedEnvelope(payload))).toEqual(payload);
	});

	test('extracts and reassembles a chunked (constructed OCTET STRING) eContent', () => {
		const payload = new TextEncoder().encode(
			'a document long enough to span several constructed OCTET STRING chunks'
		);
		expect(unwrapCadesEnvelope(buildSignedEnvelope(payload, 10))).toEqual(payload);
	});

	test('rejects a ContentInfo whose contentType is not signedData', () => {
		const notSignedData = tlv(0x30, concat([OID_ENVELOPED_DATA, tlv(0xa0, new Uint8Array(0))]));
		expect(() => unwrapCadesEnvelope(notSignedData)).toThrow(/SignedData/);
	});

	test('rejects bytes that are not ASN.1 at all', () => {
		expect(() => unwrapCadesEnvelope(new TextEncoder().encode('not a p7m file'))).toThrow();
	});

	test('rejects a well-formed SignedData with no eContent (a detached signature)', () => {
		const encapContentInfo = tlv(0x30, OID_DATA); // eContentType only, no [0] eContent
		const version = tlv(0x02, Uint8Array.from([0x01]));
		const emptySet = tlv(0x31, new Uint8Array(0));
		const signedData = tlv(0x30, concat([version, emptySet, encapContentInfo, emptySet]));
		const explicitContent = tlv(0xa0, signedData);
		const detached = tlv(0x30, concat([OID_SIGNED_DATA, explicitContent]));
		expect(() => unwrapCadesEnvelope(detached)).toThrow(/detached/);
	});
});
