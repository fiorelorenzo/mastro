import { describe, expect, test } from 'vitest';
import { decodeMessageBody, parseMessage } from './headers';

/** Joins RFC 822 header lines and a body with the required blank-line
 *  separator, so no test call site has to get the newline count right by hand. */
function message(headerLines: readonly string[], body: string): Buffer {
	return Buffer.from(headerLines.join('\r\n') + '\r\n\r\n' + body);
}

describe('parseMessage', () => {
	test('unfolds a well-formed header block and splits it from the body', () => {
		const raw = message(
			['From: Paola Ricci <paola.ricci@nordwind.example>', 'To: lorenzo@example.com'],
			'Ciao Lorenzo,\n\ngrazie'
		);
		const parsed = parseMessage(raw);
		expect(parsed.headers.get('from')).toBe('Paola Ricci <paola.ricci@nordwind.example>');
		expect(parsed.headers.get('to')).toBe('lorenzo@example.com');
		expect(parsed.body?.toString('utf8')).toBe('Ciao Lorenzo,\n\ngrazie');
	});

	test('unfolds a continuation line onto the header it belongs to', () => {
		const raw = message(['Subject: giornate agosto', ' e settembre'], 'testo');
		const parsed = parseMessage(raw);
		expect(parsed.headers.get('subject')).toBe('giornate agosto e settembre');
	});

	test('a message archived without any headers reads as all body, not a misparsed one-line header', () => {
		// The blank line after the salutation is not a header/body separator
		// here — nothing before it looks like "name: value".
		const raw = Buffer.from(
			'Ciao Lorenzo,\n\nti confermo le giornate del 17 e 18 agosto.\nGrazie, Paola'
		);
		const parsed = parseMessage(raw);
		expect(parsed.headers.size).toBe(0);
		expect(parsed.body?.toString('utf8')).toBe(raw.toString('utf8'));
	});

	test('an empty message has no body to show', () => {
		expect(parseMessage(Buffer.alloc(0)).body).toBeNull();
	});

	test('a repeated header keeps its first value', () => {
		const raw = message(['From: first@example.com', 'From: second@example.com'], 'x');
		expect(parseMessage(raw).headers.get('from')).toBe('first@example.com');
	});
});

describe('decodeMessageBody', () => {
	test('quoted-printable is reversed at the byte level, across a soft line break inside one UTF-8 character', () => {
		// "à" (U+00E0) is UTF-8 bytes C3 A0; nodemailer wraps the encoded line
		// before the second byte, so the soft break sits between "=C3" and
		// "=A0" — exactly the split a string-level decode would corrupt.
		const raw = message(
			['Content-Transfer-Encoding: quoted-printable', 'Content-Type: text/plain; charset=utf-8'],
			'la seconda mezz=C3=\r\n=A0.'
		);
		expect(decodeMessageBody(parseMessage(raw))).toBe('la seconda mezzà.');
	});

	test('base64 is decoded and re-charset-decoded', () => {
		const raw = message(
			['Content-Transfer-Encoding: base64', 'Content-Type: text/plain; charset=utf-8'],
			Buffer.from('ciao è tutto ok').toString('base64')
		);
		expect(decodeMessageBody(parseMessage(raw))).toBe('ciao è tutto ok');
	});

	test('no declared encoding is read as UTF-8 bytes as-is', () => {
		const raw = message(['Subject: x'], 'perché sì');
		expect(decodeMessageBody(parseMessage(raw))).toBe('perché sì');
	});

	test('a headerless message decodes its whole content as the body', () => {
		const raw = Buffer.from('Ciao Lorenzo,\n\ngrazie, Paola');
		expect(decodeMessageBody(parseMessage(raw))).toBe('Ciao Lorenzo,\n\ngrazie, Paola');
	});

	test('an empty body decodes to an empty string', () => {
		expect(decodeMessageBody(parseMessage(Buffer.alloc(0)))).toBe('');
	});
});
