export {
	CATEGORICAL,
	CERTAINTY_TIERS,
	SEQUENTIAL,
	SEQUENTIAL_STEPS,
	STATUS,
	STATUS_LEVELS,
	categorical,
	certainty,
	surface,
	type CategoricalSlot,
	type CertaintyTier,
	type ColorScheme,
	type SequentialStep,
	type StatusLevel,
	type SurfaceTokens
} from './palette';
export {
	contrast,
	oklch,
	validate,
	validateOrdinal,
	type ValidationResult
} from './palette-validator';

// ── chart primitives — SVG, no chart library, one table equivalent each ──
export { default as Axis } from './charts/Axis.svelte';
export { default as ChartFrame } from './charts/ChartFrame.svelte';
export { default as DataTable } from './charts/DataTable.svelte';
export { default as Grid } from './charts/Grid.svelte';
export { default as Legend } from './charts/Legend.svelte';
export { default as StatusIndicator } from './charts/StatusIndicator.svelte';
export { default as Tooltip } from './charts/Tooltip.svelte';
export type {
	AxisTick,
	SeriesEntry,
	SeriesMark,
	StatusEntry,
	TableColumn,
	TooltipRow
} from './charts/types';
