/**
 * A column of a {@link RecordList}: how to read a value out of a row, and
 * what to call it.
 *
 * `format` exists because a raw value is almost never what a user should
 * read: minor units, an ISO date, an enum. It runs in both renderings, so a
 * table cell and a phone card can never disagree about a number.
 */
export interface RecordColumn<Row> {
	readonly key: string;
	readonly label: string;
	readonly align?: 'start' | 'end';
	readonly format?: (row: Row) => string;
}

/**
 * The keys have to be unique: both renderings key their loops by column, and
 * a duplicate key takes a whole page down at hydration rather than rendering
 * something slightly wrong. That has already cost two blank pages, #143 and
 * the duplicated crumb hrefs in #152, so this one fails loudly and early.
 */
export function assertUniqueColumnKeys<Row>(columns: readonly RecordColumn<Row>[]): void {
	const seen = new Set<string>();
	for (const column of columns) {
		if (seen.has(column.key)) {
			throw new Error(`RecordList: duplicate column key ${JSON.stringify(column.key)}`);
		}
		seen.add(column.key);
	}
}
