/**
 * `Table`'s data model: the column shape and the sort logic, kept out of the
 * `.svelte` file so it can be unit tested without a component-testing
 * harness (`@testing-library/svelte` is not a dependency here — see
 * `table.test.ts`).
 */
import type { Snippet } from 'svelte';

/**
 * A column of a {@link Table}. `format` and `cell` are both optional and
 * mutually usable: a column with neither falls back to the raw row value
 * (matching `RecordList`), `format` renders a string in both the table and
 * the card view, and `cell` renders a snippet — a badge, a link, an
 * `Amount` — in both views instead. `sort` is what makes a column
 * sortable at all: its absence, not a separate boolean, is what keeps a
 * plain column's header a `<th>` rather than a `<button>`.
 */
export interface TableColumn<Row> {
	readonly key: string;
	readonly label: string;
	readonly align?: 'start' | 'end';
	readonly format?: (row: Row) => string;
	readonly cell?: Snippet<[row: Row]>;
	/** Ascending comparator, `Array.prototype.sort` semantics. Presence opts the column into sorting. */
	readonly sort?: (a: Row, b: Row) => number;
}

export type TableSortDirection = 'asc' | 'desc';

export interface TableSort {
	readonly key: string;
	readonly direction: TableSortDirection;
}

/**
 * Applies the sorted column's own comparator and direction to `rows`,
 * without mutating the caller's array — `Table` re-derives this on every
 * prop change, so an in-place sort would corrupt the caller's data on the
 * first click. Falls back to `rows` unchanged when nothing is sorted, the
 * sorted key no longer exists among `columns`, or that column isn't
 * sortable — a column list can change under an active sort without
 * throwing.
 */
export function sortRows<Row>(
	rows: readonly Row[],
	columns: readonly TableColumn<Row>[],
	sort: TableSort | null
): readonly Row[] {
	if (!sort) return rows;
	const column = columns.find((candidate) => candidate.key === sort.key);
	if (!column?.sort) return rows;
	const ordered = [...rows].sort(column.sort);
	return sort.direction === 'desc' ? ordered.reverse() : ordered;
}

/** Clicking (or activating) a header: the same column reverses direction, a different one restarts ascending. */
export function toggleTableSort(current: TableSort | null, key: string): TableSort {
	if (current?.key === key) {
		return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
	}
	return { key, direction: 'asc' };
}

/** The `aria-sort` value for a header cell — `'none'` covers both "sortable, not sorted" and "not the active column". */
export function tableAriaSort(sort: TableSort | null, key: string): 'ascending' | 'descending' | 'none' {
	if (sort?.key !== key) return 'none';
	return sort.direction === 'asc' ? 'ascending' : 'descending';
}