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
	const unfolded = unfoldLines(headerBlock);

	const isHeaderBlock =
		separator !== null && unfolded.length > 0 && unfolded.every((line) => HEADER_LINE.test(line));
	if (!isHeaderBlock) {
		return { headers: new Map(), body: raw.length > 0 ? raw : null };
	}

	const bodyStart = separator!.index! + separator![0].length;
	return { headers: headersFrom(unfolded), body: raw.subarray(bodyStart) };
}

/**
 * The headers out of a block that is *only* headers — what IMAP hands back
 * for a `BODY.PEEK[HEADER.FIELDS (...)]` fetch (#409).
 *
 * Separate from {@link parseMessage} because that one requires a blank line
 * before it will read anything as a header, deliberately: a whole message
 * whose body happens to start with a blank line would otherwise have its
 * first body line read as a header. A header-only block has no body and so
 * no blank line to find, which made `parseMessage` return an empty map for
 * it - silently, and it cost an afternoon: the poll read `In-Reply-To` as
 * absent from a block that plainly contained it.
 */
export function parseHeaderBlock(raw: Buffer): ReadonlyMap<string, string> {
	const unfolded = unfoldLines(raw.toString('latin1')).filter((line) => HEADER_LINE.test(line));
	return headersFrom(unfolded);
}

/** RFC 5322 folding: a line starting with space or tab continues the one
 * above it. Shared, because a header block read on its own has to unfold
 * exactly the way one read from a whole message does. */
function unfoldLines(block: string): string[] {
	const unfolded: string[] = [];
	for (const line of block.split(/\r?\n/)) {
		if (/^[ \t]/.test(line) && unfolded.length > 0) {
			unfolded[unfolded.length - 1] += ' ' + line.trim();
		} else {
			unfolded.push(line);
		}
	}
	return unfolded;
}

/** First occurrence of each name wins, matching `ParsedMessage.headers`. */
function headersFrom(unfolded: readonly string[]): Map<string, string> {
	const headers = new Map<string, string>();
	for (const line of unfolded) {
		const idx = line.indexOf(':');
		if (idx < 0) continue;
		const name = line.slice(0, idx).trim().toLowerCase();
		if (!headers.has(name)) headers.set(name, line.slice(idx + 1).trim());
	}
	return headers;
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

	// A multipart message's own body is the MIME container, not text
	// anybody wrote: boundaries, per-part headers, and each part's own
	// escaping still escaped (#414). Decoding it as if it were text is what
	// this function did until the live instance proved what that costs -
	// `Attivit=C3=A0` reached the model, the model answered with
	// `Attività`, and the verbatim guard that protects invariant 4 threw
	// the day away, silently. Gmail sends `multipart/alternative` for
	// everything, so on this ledger that was most approvals.
	const part = readablePart(message);
	if (part) return decodePartText(part);

	return decodePartText(message);
}

/** The transfer decode for one part, given its own headers. Split out so a
 * part chosen out of a multipart is decoded by its own `Content-Type` and
 * `Content-Transfer-Encoding` rather than the envelope's, which is the
 * whole bug in #414: the outer message says nothing useful about how the
 * text inside it is encoded. */
function decodePartText(part: ParsedMessage): string {
	if (!part.body) return '';
	const encoding = (part.headers.get('content-transfer-encoding') ?? '7bit').toLowerCase().trim();
	const charset = bufferEncoding(charsetOf(part.headers.get('content-type')));

	if (encoding === 'quoted-printable') {
		return decodeQuotedPrintable(part.body).toString(charset);
	}
	if (encoding === 'base64') {
		const ascii = part.body.toString('ascii').replace(/\s+/g, '');
		return Buffer.from(ascii, 'base64').toString(charset);
	}
	return part.body.toString(charset);
}

/**
 * The part of a multipart message a human reads, or null when the message
 * is not multipart at all.
 *
 * `text/plain` wins over `text/html`, always: it is what the sender's own
 * client generated from what they typed, and the alternative is the same
 * words wrapped in markup this product has no business un-wrapping to
 * compare an excerpt against. Nested containers are walked rather than
 * guessed at - `multipart/mixed` wrapping `multipart/alternative` is what
 * a message with an attachment looks like, and the text is two levels
 * down. An attachment is never the body: only `text/*` parts are
 * candidates, so a `mixed` whose first part is a PDF still yields the
 * text.
 */
function readablePart(message: ParsedMessage, depth = 0): ParsedMessage | null {
	// Four levels is past anything a mail client produces (`mixed` around
	// `related` around `alternative` is three) and stops a crafted message
	// from turning this into a walk without end.
	if (depth > 4) return null;
	const contentType = message.headers.get('content-type') ?? '';
	if (!/^\s*multipart\//i.test(contentType) || !message.body) return null;

	const boundary = contentType.match(/boundary\s*=\s*"?([^;"\s]+)"?/i)?.[1];
	if (!boundary) return null;

	const parts: ParsedMessage[] = [];
	// Split on the delimiter line, not on the bare boundary string: the
	// boundary is chosen to be absent from the content, but the `--`
	// prefix is what actually makes a line a delimiter (RFC 2046 §5.1.1),
	// and the closing delimiter carries a `--` suffix as well.
	for (const chunk of message.body.toString('latin1').split(`--${boundary}`)) {
		const trimmed = chunk.replace(/^\r?\n/, '');
		if (trimmed === '' || trimmed.startsWith('--')) continue;
		parts.push(parseMessage(Buffer.from(trimmed, 'latin1')));
	}

	const typeOf = (part: ParsedMessage) =>
		(part.headers.get('content-type') ?? 'text/plain').toLowerCase();
	const plain = parts.find((part) => typeOf(part).startsWith('text/plain'));
	if (plain) return plain;
	for (const part of parts) {
		const nested = readablePart(part, depth + 1);
		if (nested) return nested;
	}
	return parts.find((part) => typeOf(part).startsWith('text/')) ?? null;
}

/**
 * The `Message-ID`s a message's `References` header names, in the order it
 * names them — oldest ancestor first, which is the order RFC 5322 requires
 * (#410).
 *
 * Takes the header value, so it works the same whether it came from a whole
 * message or from a header-only IMAP fetch. Unfolding happens before this,
 * in whichever parser read the block, and it matters: a long ancestry is
 * exactly the header a client wraps, and a line-at-a-time read would keep
 * the first ids and silently drop the rest.
 *
 * Matched by angle brackets rather than split on whitespace. The grammar
 * allows comments and folding between ids, and an id itself cannot contain
 * `<` or `>`, so the brackets are the reliable delimiter. Empty array when
 * the header is absent, which is a conversation's first message.
 */
export function parseReferences(value: string | undefined): string[] {
	if (!value) return [];
	return [...value.matchAll(/<[^<>]+>/g)].map((match) => match[0]);
}
