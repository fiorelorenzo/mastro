import { expect, test } from 'vitest';
import { assertUniqueColumnKeys } from '$lib/layout/types';
import {
	sortRows,
	tableAriaSort,
	toggleTableSort,
	type TableColumn,
	type TableSort
} from './table';

interface Row {
	readonly id: string;
	readonly amount: number;
}

const columns: readonly TableColumn<Row>[] = [
	{ key: 'id', label: 'Id' },
	{ key: 'amount', label: 'Amount', align: 'end', sort: (a, b) => a.amount - b.amount }
];

const rows: readonly Row[] = [
	{ id: 'c', amount: 30 },
	{ id: 'a', amount: 10 },
	{ id: 'b', amount: 20 }
];

test('no active sort returns the rows exactly as given', () => {
	expect(sortRows(rows, columns, null)).toBe(rows);
});

test('ascending sort applies the column comparator', () => {
	expect(sortRows(rows, columns, { key: 'amount', direction: 'asc' }).map((r) => r.id)).toEqual([
		'a',
		'b',
		'c'
	]);
});

test('descending sort reverses the ascending comparator rather than inverting it', () => {
	// Reversing an ascending sort keeps ties in their original relative order
	// (stable), which negating the comparator would not.
	expect(sortRows(rows, columns, { key: 'amount', direction: 'desc' }).map((r) => r.id)).toEqual([
		'c',
		'b',
		'a'
	]);
});

test('sorting never mutates the caller-supplied array', () => {
	const original = [...rows];
	sortRows(rows, columns, { key: 'amount', direction: 'asc' });
	expect(rows).toEqual(original);
});

test('a column with no comparator is inert even when named as the sort key', () => {
	expect(sortRows(rows, columns, { key: 'id', direction: 'asc' })).toBe(rows);
});

test('a sort key naming a column that no longer exists is ignored, not thrown', () => {
	expect(sortRows(rows, columns, { key: 'gone', direction: 'asc' })).toBe(rows);
});

test('an empty row set sorts to an empty row set', () => {
	expect(sortRows([], columns, { key: 'amount', direction: 'asc' })).toEqual([]);
});

test('toggling a fresh column starts ascending', () => {
	expect(toggleTableSort(null, 'amount')).toEqual({ key: 'amount', direction: 'asc' });
});

test('toggling the active column reverses its direction', () => {
	const first: TableSort = { key: 'amount', direction: 'asc' };
	expect(toggleTableSort(first, 'amount')).toEqual({ key: 'amount', direction: 'desc' });
});

test('toggling a different column restarts ascending rather than carrying the old direction over', () => {
	const active: TableSort = { key: 'amount', direction: 'desc' };
	expect(toggleTableSort(active, 'id')).toEqual({ key: 'id', direction: 'asc' });
});

test('aria-sort is "none" for every column until its key is the active sort', () => {
	expect(tableAriaSort(null, 'amount')).toBe('none');
	expect(tableAriaSort({ key: 'id', direction: 'asc' }, 'amount')).toBe('none');
});

test('aria-sort names the direction for the active column', () => {
	expect(tableAriaSort({ key: 'amount', direction: 'asc' }, 'amount')).toBe('ascending');
	expect(tableAriaSort({ key: 'amount', direction: 'desc' }, 'amount')).toBe('descending');
});

test('column keys must be unique, the same rule Table inherits from RecordList', () => {
	expect(() =>
		assertUniqueColumnKeys([...columns, { key: 'amount', label: 'Amount again' }])
	).toThrow(/duplicate column key "amount"/);
	expect(() => assertUniqueColumnKeys(columns)).not.toThrow();
});
