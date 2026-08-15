import { describe, expect, test } from 'vitest';
import { checkVerbatim, normaliseForComparison, verbatimSpans } from './verbatim';

// The document these quote from, shaped like a real contract: the parties
// at the top, eight articles, the date at the bottom.
const CONTRACT = [
	'CONTRATTO DI CONSULENZA PROFESSIONALE',
	'Tra Ortofrutta Bassano S.r.l., con sede in Via dei Tigli 14, P.IVA 04455667788',
	'e il dott. Marco Venturi, consulente indipendente.',
	'Art. 1 - Oggetto',
	'Il Consulente presta attivita di consulenza tecnica.',
	'Art. 6 - Rinnovo',
	'Alla scadenza il contratto si intende rinnovato salvo disdetta.',
	'Bassano del Grappa, 12 agosto 2026'
].join('\n');

const MINIMUM = 20;

describe('verbatimSpans', () => {
	test('a plain quotation is one span', () => {
		expect(verbatimSpans('Art. 6 - Rinnovo')).toEqual(['Art. 6 - Rinnovo']);
	});

	test.each([['[...]'], ['[…]'], ['[ ... ]'], ['[. . .]']])('%s marks a gap', (marker) => {
		expect(verbatimSpans(`before ${marker} after`)).toEqual(['before', 'after']);
	});

	test('a bracket that is not an elision is left alone', () => {
		expect(verbatimSpans('the party [the Client] agrees')).toEqual([
			'the party [the Client] agrees'
		]);
	});
});

describe('checkVerbatim', () => {
	test('a contiguous quotation passes, whatever the line wrapping', () => {
		const wrapped = 'Tra Ortofrutta Bassano S.r.l.,   con sede in\n Via dei Tigli 14';

		expect(checkVerbatim(wrapped, CONTRACT, MINIMUM)).toEqual({ ok: true });
	});

	// The case that produced this change: the parties and the date are
	// both in the document, seven articles apart.
	test('two spans that are each in the document pass', () => {
		const quotation =
			'Tra Ortofrutta Bassano S.r.l., con sede in Via dei Tigli 14 [...] Bassano del Grappa, 12 agosto 2026';

		expect(checkVerbatim(quotation, CONTRACT, MINIMUM)).toEqual({ ok: true });
	});

	// What the extraction actually sent on 2026-08-15: the same two spans,
	// joined with a newline and no marker. Nothing tells us the author
	// meant a gap rather than a claim of contiguity, and splitting on
	// whitespace would let assembled prose through, so this stays refused.
	test('two spans silently concatenated are still refused', () => {
		const stitched =
			'Tra Ortofrutta Bassano S.r.l., con sede in Via dei Tigli 14\nBassano del Grappa, 12 agosto 2026';
		const result = checkVerbatim(stitched, CONTRACT, MINIMUM);

		expect(result.ok).toBe(false);
		expect(result.ok === false && result.reason).toContain('not verbatim');
	});

	test('a quotation naming which side failed says which side', () => {
		const quotation =
			'Tra Ortofrutta Bassano S.r.l., con sede in Via dei Tigli 14 [...] firmato a Milano nel 2019';
		const result = checkVerbatim(quotation, CONTRACT, MINIMUM);

		expect(result.ok).toBe(false);
		expect(result.ok === false && result.reason).toContain('firmato a Milano');
		expect(result.ok === false && result.reason).toContain('one side');
	});

	// The reason the floor exists: every document contains "il", so
	// without it a sentence could be assembled from scattered words.
	test('a stray fragment cannot be one side of an elided quotation', () => {
		const quotation = 'Il Consulente presta attivita di consulenza tecnica. [...] il';
		const result = checkVerbatim(quotation, CONTRACT, MINIMUM);

		expect(result.ok).toBe(false);
		expect(result.ok === false && result.reason).toContain('too short to be evidence');
	});

	test('a single short quotation is left to its caller, unchanged', () => {
		expect(checkVerbatim('Art. 6 - Rinnovo', CONTRACT, MINIMUM)).toEqual({ ok: true });
	});

	test('an empty quotation is refused rather than trivially passing', () => {
		expect(checkVerbatim('   [...]   ', CONTRACT, MINIMUM)).toEqual({
			ok: false,
			reason: 'the quotation is empty'
		});
	});
});

describe('normaliseForComparison', () => {
	test('collapses the whitespace a PDF extractor and a model disagree about', () => {
		expect(normaliseForComparison('  a \n\t b  ')).toBe('a b');
	});
});
