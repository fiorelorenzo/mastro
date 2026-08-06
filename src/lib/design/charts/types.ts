import type { StatusLevel } from '../palette';

/** A single tick on an `Axis`, already resolved to a pixel position by the caller's scale. */
export interface AxisTick {
	readonly position: number;
	readonly label: string;
}

export type SeriesMark = 'rect' | 'line';

/** One categorical or ordinal series in a `Legend`. */
export interface SeriesEntry {
	readonly id: string;
	readonly label: string;
	readonly color: string;
	readonly mark?: SeriesMark;
}

/**
 * A status entry for `Legend` or `StatusIndicator`. `label` has no default:
 * a status color is never rendered without the text that explains it. The
 * icon is derived from `level` by the component, never supplied by the
 * caller, so a status color can't drift from its icon.
 */
export interface StatusEntry {
	readonly level: StatusLevel;
	readonly label: string;
}

/** One row in a `Tooltip`. */
export interface TooltipRow {
	readonly label: string;
	readonly value: string;
	readonly color?: string;
}

/** A `DataTable` / `ChartFrame` column. `format` runs on the raw cell value. */
export interface TableColumn<Row> {
	readonly key: keyof Row & string;
	readonly label: string;
	readonly align?: 'start' | 'end';
	readonly format?: (row: Row) => string;
}
