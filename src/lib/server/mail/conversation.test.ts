import { expect, test } from 'vitest';
import { renderConversation, stripQuotedHistory } from './conversation';

// The bodies below are cut from the real Visum Labs exchange that produced
// #400, with the addresses left as they arrived: this is the data the
// stripper has to survive, not an invented shape.

test('a reply keeps its own words and drops the quoted parent, attribution included', () => {
	const body = [
		'Ciao Leo,',
		'',
		'tutto ok, confermo.',
		'',
		'A presto,',
		'Lorenzo',
		'',
		'> Il giorno 5 ago 2026, alle ore 18:38, Leonardo Ubbiali <leo@visumlabs.com> ha scritto:',
		'>',
		'> Ciao Lorenzo,',
		'>',
		"> ti confermo l'allocazione di mezza giornata per i meeting con Polymarket."
	].join('\n');

	const stripped = stripQuotedHistory(body);

	expect(stripped).toContain('tutto ok, confermo.');
	// The whole quoted offer is gone, which is the duplicate this fixes: the
	// same sentence used to be extracted once per message that quoted it.
	expect(stripped).not.toContain('mezza giornata');
	expect(stripped).not.toContain('Leonardo Ubbiali');
});

test('the Gmail attribution line above a quote goes with the quote, not the reply', () => {
	const body = [
		'Ciao Leo,',
		'',
		'firmato.',
		'A domani per il kickoff!',
		'',
		'Il giorno lun 3 ago 2026 alle ore 17:14 Leonardo Ubbiali <leo@visumlabs.com>',
		'ha scritto:',
		'',
		'> Nuovo link per la firma: https://docuseal.com/s/4jbtgW16i9B2Jp'
	].join('\n');

	const stripped = stripQuotedHistory(body);

	expect(stripped).toContain('A domani per il kickoff!');
	expect(stripped).not.toContain('docuseal.com');
	// Gmail wrapped this attribution across two lines. Both go: the second
	// carries the colon the detector matches, and the first is taken as its
	// continuation because it opens like an attribution and does not end like
	// a sentence.
	expect(stripped).not.toContain('ha scritto:');
	expect(stripped).not.toContain('Il giorno lun 3 ago');
	expect(stripped.trimEnd()).toBe('Ciao Leo,\n\nfirmato.\nA domani per il kickoff!');
});

test('an English "On ... wrote:" attribution is recognised too', () => {
	const body = [
		'Grazie!',
		'',
		'On Wed, 5 Aug 2026 at 17:41, Lorenzo Fiore wrote:',
		'',
		'> ok'
	].join('\n');

	const stripped = stripQuotedHistory(body);

	expect(stripped).toBe('Grazie!');
});

test('a signature block is dropped, and so is everything after it', () => {
	const body = [
		'This email is to confirm your assignment of working days.',
		'',
		'Best,',
		'Leo',
		'',
		'-- ',
		'*Leonardo Ubbiali*',
		'*Founder & CEO*',
		'+44 7930865830'
	].join('\n');

	const stripped = stripQuotedHistory(body);

	expect(stripped).toContain('assignment of working days');
	expect(stripped).not.toContain('Founder');
	expect(stripped).not.toContain('7930865830');
});

test('a line that merely mentions a date is not an attribution', () => {
	// The false positive worth defending against: this sentence ends in a
	// colon and names a date, and deleting it would delete the confirmation
	// itself.
	const body = ['Ti confermo le giornate seguenti:', '- 4 agosto, mezza giornata'].join('\n');

	expect(stripQuotedHistory(body)).toBe(body);
});

test('a body with no quoting at all comes back unchanged apart from trimming', () => {
	const body = 'ok for Thursday\n';
	expect(stripQuotedHistory(body)).toBe('ok for Thursday');
});

test('rendering numbers the messages from zero and carries the date and sender', () => {
	const rendered = renderConversation([
		{
			documentId: 'a',
			sentAt: '2026-08-05',
			from: 'leo@visumlabs.com',
			body: "ti confermo l'allocazione di mezza giornata"
		},
		{
			documentId: 'b',
			sentAt: '2026-08-05',
			from: 'lorenzo@example.com',
			body: 'tutto ok, confermo'
		}
	]);

	// 0-based, so the number in the header is literally the `messageIndex` the
	// model has to echo back. Pinned by a test because the whole point is that
	// the two numbering schemes cannot drift apart.
	expect(rendered).toContain('--- message 0, 2026-08-05, leo@visumlabs.com ---');
	expect(rendered).toContain('--- message 1, 2026-08-05, lorenzo@example.com ---');
	expect(rendered.indexOf('message 0')).toBeLessThan(rendered.indexOf('message 1'));
});
