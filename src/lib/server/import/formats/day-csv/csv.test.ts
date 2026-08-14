import { describe, expect, test } from 'vitest';
import { detectDelimiter, parseCsv } from './csv';

describe('detectDelimiter', () => {
	test('picks comma when the header carries more commas than semicolons', () => {
		expect(detectDelimiter('date,quantity,scope,client')).toBe(',');
	});

	test('picks semicolon when the header carries more semicolons than commas', () => {
		expect(detectDelimiter('date;quantity;scope;client')).toBe(';');
	});

	test('ignores a delimiter character sitting inside a quoted header cell', () => {
		expect(detectDelimiter('date;"scope, or task";client')).toBe(';');
	});

	test('defaults to comma on a tie, including a header with neither', () => {
		expect(detectDelimiter('onlyOneColumn')).toBe(',');
	});
});

describe('parseCsv', () => {
	test('splits a plain comma-delimited file into rows of cells', () => {
		const rows = parseCsv('date,quantity,scope\n2026-01-05,1,Migrated the API\n');
		expect(rows).toEqual([
			['date', 'quantity', 'scope'],
			['2026-01-05', '1', 'Migrated the API']
		]);
	});

	test('a quoted field keeps an embedded delimiter intact', () => {
		const rows = parseCsv('date,scope\n2026-01-05,"API migration, phase 2"', ',');
		expect(rows).toEqual([
			['date', 'scope'],
			['2026-01-05', 'API migration, phase 2']
		]);
	});

	test('a doubled quote inside a quoted field becomes one literal quote', () => {
		const rows = parseCsv('scope\n"the client said ""ship it"""', ',');
		expect(rows).toEqual([['scope'], ['the client said "ship it"']]);
	});

	test('a quoted field may embed a real line break', () => {
		const rows = parseCsv('scope\n"line one\nline two"', ',');
		expect(rows).toEqual([['scope'], ['line one\nline two']]);
	});

	test('CRLF, bare LF and a bare CR all end a row', () => {
		const rows = parseCsv('a\r\nb\nc\rd', ',');
		expect(rows).toEqual([['a'], ['b'], ['c'], ['d']]);
	});

	test('a leading UTF-8 BOM never becomes part of the first header', () => {
		const rows = parseCsv('\uFEFFdate,scope\n2026-01-05,x', ',');
		expect(rows[0][0]).toBe('date');
	});

	test('a trailing newline produces no spurious blank final row', () => {
		const rows = parseCsv('a,b\nc,d\n', ',');
		expect(rows).toEqual([
			['a', 'b'],
			['c', 'd']
		]);
	});

	test('an empty file parses to no rows at all', () => {
		expect(parseCsv('', ',')).toEqual([]);
	});

	test('a genuinely blank line still parses as a one-cell empty row — the caller decides what that means', () => {
		const rows = parseCsv('a,b\n\nc,d', ',');
		expect(rows).toEqual([['a', 'b'], [''], ['c', 'd']]);
	});

	test('a semicolon-delimited row keeps a comma-decimal quantity in one cell', () => {
		const rows = parseCsv('date;quantity\n2026-01-05;1,5', ';');
		expect(rows).toEqual([
			['date', 'quantity'],
			['2026-01-05', '1,5']
		]);
	});
});
