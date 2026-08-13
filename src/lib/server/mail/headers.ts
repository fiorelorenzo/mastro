// Minimal RFC 5322 header-block parsing for an archived raw message
// (`document.mime === 'message/rfc822'`). Two independent readers of this
// shape existed until now — `repositories/proposal.ts`'s own sender
// extraction for the approval an accepted proposal writes, and the
// proposal review screen's evidence panel, which needs the rest of the
// envelope (`To`, `Date`, `Subject`) plus the decoded body — so this is
// the one place both go through rather than two folding parsers quietly
// drifting apart.
//
// Deliberately not a general MIME parser: this product only ever composes
// (`mail/message.ts`) or archives (`mail/poll.ts`) a single-part
// `text/plain` message, so a `multipart/*` body is read as opaque bytes
// rather than walked for its first text part — nothing today produces one.

/** A header field name: printable US-ASCII except colon and whitespace
 *  (RFC 5322 §2.2's `ftext`), the same character class `extractSender`
 *  checked against before this module existed. */
const HEADER_LINE = /^[!-9;-~]+:/;

export type ParsedMessage = {
	/** Header name (lowercase) → unfolded value; the first occurrence of a
	 *  repeated header wins, the same as every reader downstream of this
	 *  one only ever wants the primary `From`/`To`/`Date`/`Subject`. */
	headers: ReadonlyMap<string, string>;
	/** Raw bytes after the header/body blank line. `null` when no valid
	 *  header block was found — an archived message stored without
	 *  headers (a test fixture, or an ingestion path that only ever kept
	 *  the body) reads as an all-body message rather than throwing. */
	body: Buffer | null;
};

/**
 * Splits `raw` into its header map and body bytes.
 *
 * Read as Latin-1 to find the blank-line boundary: `\r`/`\n` are always
 * single-byte ASCII regardless of the body's own charset, so a byte-for-
 * byte Latin-1 decode locates that boundary correctly even through a
 * multi-byte UTF-8 body — and header field names and values (unlike the
 * body) are themselves always ASCII per RFC 5322, so nothing is lost
 * decoding them this way either.
 *
 * The candidate header block is accepted only when every one of its
 * unfolded lines looks like a header (`name:` at the front) — not merely
 * "the text before the first blank line", which a message whose body
 * itself starts with a blank line (e.g. `"Ciao,\n\ntesto"`) would
 * otherwise misread as a one-line header block.
 */
export function parseMessage(raw: Buffer): ParsedMessage {
	const text = raw.toString('latin1');
	const separator = text.match(/\r?\n\r?\n/);
	const headerBlock = separator ? text.slice(0, separator.index) : text;

	const unfolded: string[] = [];
	for (const line of headerBlock.split(/\r?\n/)) {
		if (/^[ \t]/.test(line) && unfolded.length > 0) {
			unfolded[unfolded.length - 1] += ' ' + line.trim();
		} else {
			unfolded.push(line);
		}
	}

	const isHeaderBlock =
		separator !== null && unfolded.length > 0 && unfolded.every((line) => HEADER_LINE.test(line));
	if (!isHeaderBlock) {
		return { headers: new Map(), body: raw.length > 0 ? raw : null };
	}

	const headers = new Map<string, string>();
	for (const line of unfolded) {
		const idx = line.indexOf(':');
		const name = line.slice(0, idx).trim().toLowerCase();
		const value = line.slice(idx + 1).trim();
		if (!headers.has(name)) headers.set(name, value);
	}

	const bodyStart = separator!.index! + separator![0].length;
	return { headers, body: raw.subarray(bodyStart) };
}

/** The `charset=` parameter off a `Content-Type` header value, lowercased.
 *  `null` when absent or the header itself is missing. */
function charsetOf(contentType: string | undefined): string | null {
	const match = contentType?.match(/charset\s*=\s*"?([^;"\s]+)"?/i);
	return match ? match[1].toLowerCase() : null;
}

/** Node's `Buffer` only decodes a handful of encoding names natively;
 *  every charset this product's own mail stack ever declares
 *  (`mail/message.ts` always sets `utf-8`) maps onto one of them. */
const BUFFER_ENCODING_BY_CHARSET: Record<string, BufferEncoding> = {
	'us-ascii': 'ascii',
	ascii: 'ascii',
	'iso-8859-1': 'latin1',
	latin1: 'latin1'
};

/** Anything not in the table above — including no declared charset at
 *  all — falls back to UTF-8 rather than throwing on an unrecognised
 *  label. */
function bufferEncoding(charset: string | null): BufferEncoding {
	return (charset && BUFFER_ENCODING_BY_CHARSET[charset]) || 'utf-8';
}

/** Reverses quoted-printable at the byte level (RFC 2045 §6.7): a soft
 *  line break (`=` immediately before the line ending) is removed
 *  entirely, and `=XX` is the literal byte `0xXX` — decoded on the raw
 *  bytes, not a decoded string, so a `=C3=A0` split across the encoding
 *  boundary of a multi-byte UTF-8 character reassembles correctly before
 *  the charset decode ever runs. */
function decodeQuotedPrintable(input: Buffer): Buffer {
	const out: number[] = [];
	for (let i = 0; i < input.length; i++) {
		const byte = input[i];
		if (byte === 0x3d /* '=' */) {
			if (input[i + 1] === 0x0d && input[i + 2] === 0x0a) {
				i += 2;
				continue;
			}
			if (input[i + 1] === 0x0a) {
				i += 1;
				continue;
			}
			const hex = String.fromCharCode(input[i + 1] ?? 0, input[i + 2] ?? 0);
			const value = Number.parseInt(hex, 16);
			if (!Number.isNaN(value)) {
				out.push(value);
				i += 2;
				continue;
			}
		}
		out.push(byte);
	}
	return Buffer.from(out);
}

/**
 * The body as readable text, decoded per the message's own
 * `Content-Transfer-Encoding`/`Content-Type` — never the raw
 * quoted-printable-escaped bytes a naive `.toString()` would show.
 * Empty string for a message with no body at all (`body: null`).
 */
export function decodeMessageBody(message: ParsedMessage): string {
	if (!message.body) return '';
	const encoding = (message.headers.get('content-transfer-encoding') ?? '7bit')
		.toLowerCase()
		.trim();
	const charset = bufferEncoding(charsetOf(message.headers.get('content-type')));

	if (encoding === 'quoted-printable') {
		return decodeQuotedPrintable(message.body).toString(charset);
	}
	if (encoding === 'base64') {
		const ascii = message.body.toString('ascii').replace(/\s+/g, '');
		return Buffer.from(ascii, 'base64').toString(charset);
	}
	return message.body.toString(charset);
}
