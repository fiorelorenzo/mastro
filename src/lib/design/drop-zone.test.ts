import { expect, test } from 'vitest';
import {
	acceptSummary,
	fileMatchesAccept,
	mergeSelection,
	parseAccept,
	partitionByAccept,
	removeFileAt,
	type AcceptRule
} from './drop-zone';

function file(name: string, type = '', bits: BlobPart[] = ['x']): File {
	return new File(bits, name, { type });
}

// ── parseAccept ────────────────────────────────────────────────────────

test('a blank or absent accept parses to no rules at all', () => {
	expect(parseAccept(undefined)).toEqual([]);
	expect(parseAccept(null)).toEqual([]);
	expect(parseAccept('')).toEqual([]);
	expect(parseAccept('   ')).toEqual([]);
});

test('extensions, exact mime types and mime wildcards each parse to their own rule kind', () => {
	expect(parseAccept('.pdf, application/pdf, image/*')).toEqual([
		{ kind: 'extension', value: '.pdf' },
		{ kind: 'mime', value: 'application/pdf' },
		{ kind: 'mime-wildcard', value: 'image' }
	] satisfies AcceptRule[]);
});

test('parseAccept lower-cases every clause, matching the case-insensitive native attribute', () => {
	expect(parseAccept('.PDF,Application/PDF')).toEqual([
		{ kind: 'extension', value: '.pdf' },
		{ kind: 'mime', value: 'application/pdf' }
	] satisfies AcceptRule[]);
});

// ── fileMatchesAccept ─────────────────────────────────────────────────

test('no accept rules means every file matches, same as a native input with no accept attribute', () => {
	expect(fileMatchesAccept(file('anything.exe', 'application/octet-stream'), [])).toBe(true);
});

test('an extension rule matches by filename suffix, case-insensitively, regardless of the reported mime type', () => {
	const rules = parseAccept('.pdf');
	expect(fileMatchesAccept(file('contract.PDF', ''), rules)).toBe(true);
	expect(fileMatchesAccept(file('contract.pdf.txt', 'application/pdf'), rules)).toBe(false);
});

test('an exact mime rule matches the reported type only, ignoring the filename', () => {
	const rules = parseAccept('application/pdf');
	expect(fileMatchesAccept(file('report.pdf', 'application/pdf'), rules)).toBe(true);
	expect(fileMatchesAccept(file('report.pdf', 'application/octet-stream'), rules)).toBe(false);
});

test('a mime wildcard rule matches any subtype under its type', () => {
	const rules = parseAccept('image/*');
	expect(fileMatchesAccept(file('photo.png', 'image/png'), rules)).toBe(true);
	expect(fileMatchesAccept(file('photo.png', 'video/mp4'), rules)).toBe(false);
});

test('a file needs to satisfy only one of several accept clauses', () => {
	const rules = parseAccept('.pdf,.eml,.png,.jpg,.jpeg,.txt');
	expect(fileMatchesAccept(file('receipt.eml', 'message/rfc822'), rules)).toBe(true);
	expect(fileMatchesAccept(file('receipt.docx', 'application/msword'), rules)).toBe(false);
});

// ── partitionByAccept ─────────────────────────────────────────────────

test('partitionByAccept splits a drop into what accept allows and what it refuses', () => {
	const good = file('invoice.pdf', 'application/pdf');
	const bad = file('invoice.docx', 'application/msword');
	const result = partitionByAccept([good, bad], '.pdf,application/pdf');
	expect(result.accepted).toEqual([good]);
	expect(result.rejected).toEqual([bad]);
});

test('an unrestricted drop zone accepts everything dropped on it', () => {
	const files = [file('a.txt'), file('b.bin', 'application/octet-stream')];
	expect(partitionByAccept(files, undefined)).toEqual({ accepted: files, rejected: [] });
});

// ── acceptSummary ─────────────────────────────────────────────────────

test('acceptSummary names every clause, comma-joined, for the rejection message', () => {
	expect(acceptSummary('.pdf,.eml,.png')).toBe('.pdf, .eml, .png');
	expect(acceptSummary('image/*')).toBe('image/*');
	expect(acceptSummary(undefined)).toBe('');
});

// ── mergeSelection ────────────────────────────────────────────────────

test('a single-file zone replaces the whole selection with the first dropped file', () => {
	const existing = [file('old.pdf')];
	const dropped = [file('new.pdf'), file('second.pdf')];
	expect(mergeSelection(existing, dropped, false)).toEqual([dropped[0]]);
});

test('a multi-file zone appends a drop onto whatever is already chosen', () => {
	const existing = [file('first.csv')];
	const dropped = [file('second.csv')];
	expect(mergeSelection(existing, dropped, true)).toEqual([existing[0], dropped[0]]);
});

test('dropping a file already in the selection does not duplicate it', () => {
	const existing = [file('report.csv', 'text/csv')];
	const sameAgain = new File(['x'], 'report.csv', {
		type: 'text/csv',
		lastModified: existing[0].lastModified
	});
	expect(mergeSelection(existing, [sameAgain], true)).toEqual(existing);
});

test('a same-named file with different content (different size) is kept as a second entry', () => {
	const existing = [file('report.csv', 'text/csv', ['a'])];
	const changed = file('report.csv', 'text/csv', ['a', 'longer content']);
	expect(mergeSelection(existing, [changed], true)).toEqual([existing[0], changed]);
});

test('dropping nothing leaves the existing selection untouched', () => {
	const existing = [file('kept.pdf')];
	expect(mergeSelection(existing, [], true)).toEqual(existing);
	expect(mergeSelection(existing, [], false)).toEqual(existing);
});

// ── removeFileAt ──────────────────────────────────────────────────────

test('removeFileAt drops exactly the file at that index, keeping the rest in order', () => {
	const files = [file('a.pdf'), file('b.pdf'), file('c.pdf')];
	expect(removeFileAt(files, 1)).toEqual([files[0], files[2]]);
});

test('removeFileAt on the only file empties the selection', () => {
	const files = [file('only.pdf')];
	expect(removeFileAt(files, 0)).toEqual([]);
});
