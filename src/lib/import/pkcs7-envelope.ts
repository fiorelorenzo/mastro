// Unwraps a CAdES `.p7m` signed envelope to reach the document inside
// (#43). A `.p7m` is a CMS (RFC 5652) `ContentInfo` of type `signedData`,
// DER-encoded, carrying the original document verbatim as the
// `SignedData.encapContentInfo.eContent` OCTET STRING. This reaches that
// OCTET STRING with a minimal hand-rolled ASN.1 DER reader rather than a
// PKCS#7 library: mastro never verifies the signature (there is no
// certificate chain to trust here — the document has already been imported
// from an approved folder), it only needs the bytes the signature covers,
// which is a much smaller problem than parsing certificates and signer
// info. A file this cannot make sense of throws, same contract as an
// `InvoiceFormatAdapter.parse` on a malformed document (see adapter.ts) —
// there is no human in this path to notice a wrong field either.

const TAG_CLASS_UNIVERSAL = 0;
const TAG_CLASS_CONTEXT = 2;
const UNIVERSAL_OCTET_STRING = 4;
const UNIVERSAL_OID = 6;
const UNIVERSAL_SEQUENCE = 16;

interface Tlv {
	readonly tagClass: number;
	readonly tagNumber: number;
	readonly constructed: boolean;
	readonly contentStart: number;
	readonly contentEnd: number;
}

/** Reads one DER TLV (tag-length-value) starting at `offset`. Long-form
 * lengths are supported (real `.p7m` files routinely exceed the 127-byte
 * short-form limit); indefinite length (BER, not DER) is not, and throws —
 * a real CAdES envelope is always DER. Multi-byte ("high") tag numbers
 * (tag number >= 31) are not needed by anything this file reads and also
 * throw rather than silently misparsing. */
function readTlv(buf: Uint8Array, offset: number): Tlv {
	if (offset >= buf.length) throw new Error('unexpected end of ASN.1 data');
	const tagByte = buf[offset];
	const tagNumber = tagByte & 0x1f;
	if (tagNumber === 0x1f) throw new Error('multi-byte ASN.1 tag numbers are not supported');
	const tagClass = tagByte >> 6;
	const constructed = (tagByte & 0x20) !== 0;

	let pos = offset + 1;
	if (pos >= buf.length) throw new Error('unexpected end of ASN.1 data');
	const lengthByte = buf[pos];
	pos += 1;
	let length: number;
	if (lengthByte < 0x80) {
		length = lengthByte;
	} else if (lengthByte === 0x80) {
		throw new Error('indefinite-length ASN.1 encoding is not supported');
	} else {
		const lengthByteCount = lengthByte & 0x7f;
		if (pos + lengthByteCount > buf.length) throw new Error('truncated ASN.1 length');
		length = 0;
		for (let i = 0; i < lengthByteCount; i++) length = length * 256 + buf[pos + i];
		pos += lengthByteCount;
	}
	if (pos + length > buf.length) throw new Error('truncated ASN.1 value');
	return { tagClass, tagNumber, constructed, contentStart: pos, contentEnd: pos + length };
}

/** Every top-level TLV inside a constructed value's content range. */
function readChildren(buf: Uint8Array, parent: Tlv): Tlv[] {
	const children: Tlv[] = [];
	let offset = parent.contentStart;
	while (offset < parent.contentEnd) {
		const child = readTlv(buf, offset);
		children.push(child);
		offset = child.contentEnd;
	}
	return children;
}

function isTag(tlv: Tlv, tagClass: number, tagNumber: number): boolean {
	return tlv.tagClass === tagClass && tlv.tagNumber === tagNumber;
}

// DER encoding of the PKCS#7/CMS `signedData` content type,
// 1.2.840.113549.1.7.2.
const SIGNED_DATA_OID = new Uint8Array([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02]);

/** The bytes of an OCTET STRING, concatenating a constructed encoding's
 * primitive children if it is not encoded as one plain primitive value —
 * both are legal DER for a large `eContent`. */
function octetStringContent(buf: Uint8Array, octet: Tlv): Uint8Array {
	if (!isTag(octet, TAG_CLASS_UNIVERSAL, UNIVERSAL_OCTET_STRING)) {
		throw new Error('signed envelope content is not an OCTET STRING');
	}
	if (!octet.constructed) return buf.slice(octet.contentStart, octet.contentEnd);
	const parts = readChildren(buf, octet).map((child) => octetStringContent(buf, child));
	const total = parts.reduce((sum, part) => sum + part.length, 0);
	const out = new Uint8Array(total);
	let position = 0;
	for (const part of parts) {
		out.set(part, position);
		position += part.length;
	}
	return out;
}

/**
 * Extracts the original document from a DER-encoded CMS `ContentInfo` of
 * type `signedData`. Throws with a descriptive message on anything that
 * does not match that shape, rather than guessing.
 */
export function unwrapCadesEnvelope(bytes: Uint8Array): Uint8Array {
	const contentInfo = readTlv(bytes, 0);
	if (!isTag(contentInfo, TAG_CLASS_UNIVERSAL, UNIVERSAL_SEQUENCE)) {
		throw new Error('not a CMS ContentInfo: expected a top-level SEQUENCE');
	}
	const [contentType, explicitContent] = readChildren(bytes, contentInfo);
	if (!contentType || !isTag(contentType, TAG_CLASS_UNIVERSAL, UNIVERSAL_OID)) {
		throw new Error('not a CMS ContentInfo: missing contentType OID');
	}
	const contentTypeOid = bytes.slice(contentType.contentStart, contentType.contentEnd);
	const matchesSignedData =
		contentTypeOid.length === SIGNED_DATA_OID.length &&
		contentTypeOid.every((byte, i) => byte === SIGNED_DATA_OID[i]);
	if (!matchesSignedData) {
		throw new Error('not a CMS SignedData envelope (unexpected contentType OID)');
	}
	if (!explicitContent || !isTag(explicitContent, TAG_CLASS_CONTEXT, 0)) {
		throw new Error('not a CMS ContentInfo: missing [0] content');
	}

	const [signedData] = readChildren(bytes, explicitContent);
	if (!signedData || !isTag(signedData, TAG_CLASS_UNIVERSAL, UNIVERSAL_SEQUENCE)) {
		throw new Error('not a CMS SignedData: expected a SEQUENCE inside [0]');
	}

	// version (INTEGER) and digestAlgorithms (SET) come first, in that
	// order, but neither is needed to reach eContent — skip straight to the
	// first child shaped like EncapsulatedContentInfo (a SEQUENCE).
	const encapContentInfo = readChildren(bytes, signedData).find((child) =>
		isTag(child, TAG_CLASS_UNIVERSAL, UNIVERSAL_SEQUENCE)
	);
	if (!encapContentInfo) {
		throw new Error('not a CMS SignedData: missing encapContentInfo');
	}

	const eContentWrapper = readChildren(bytes, encapContentInfo).find((child) =>
		isTag(child, TAG_CLASS_CONTEXT, 0)
	);
	if (!eContentWrapper) {
		throw new Error('signed envelope carries no content (detached signature)');
	}
	const [eContent] = readChildren(bytes, eContentWrapper);
	if (!eContent) throw new Error('signed envelope carries an empty content wrapper');
	return octetStringContent(bytes, eContent);
}
