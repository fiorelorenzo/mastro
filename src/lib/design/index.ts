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

// ── form controls — Field owns label/hint/error/aria wiring; the others
// are thin wrappers around their native element (see field-context.ts) ──
export { default as Button } from './Button.svelte';
export { default as Field } from './Field.svelte';
export { default as Input } from './Input.svelte';
export { default as Textarea } from './Textarea.svelte';
export { default as Select } from './Select.svelte';
export { default as Checkbox } from './Checkbox.svelte';
export { default as Radio } from './Radio.svelte';
export { default as SegmentedControl } from './SegmentedControl.svelte';
export { countryOptions, type CountryOption } from './country-picker';
export { parseAriaInvalid, resolveControlState, useField, type FieldState } from './field-context';
export { computeFieldIds, type FieldIds } from './field-ids';
export { keyToDirection, nextEnabledIndex, type SegmentedOption } from './segmented-control';

// ── status & badges — glyph-plus-colour, colour never alone ─────────────
export { default as Badge } from './Badge.svelte';
export {
	BADGE_GLYPH,
	BADGE_SIZES,
	BADGE_VARIANTS,
	type BadgeSize,
	type BadgeVariant
} from './badge-variants';
export {
	queuedDayStatusBadge,
	workUnitStateBadge,
	workUnitStates,
	type StateBadge,
	type WorkUnitStateValue
} from './day-state-badge';

// ── money — the only place a `MinorUnits`/major-unit amount gets printed
// or typed; see amount-format.ts and $lib/decimal for why the two units
// never share one prop ──
export { default as Amount } from './Amount.svelte';
export { default as AmountInput } from './AmountInput.svelte';
export { formatAmountValue, type AmountSize, type AmountValue } from './amount-format';

// ── evidence — the archived original behind an approval, a proposal, an
// invoice or an expense, linked identically everywhere the row exists;
// see source-document.ts for why the provenance union is duplicated ──
export { default as SourceDocument } from './SourceDocument.svelte';
export {
	DOCUMENT_PROVENANCES,
	documentProvenanceLabel,
	type DocumentProvenanceValue
} from './source-document';

// ── empty & error states — one shell for "nothing here" and one for
// "something's wrong," a glyph/status chip plus title, body and a way
// forward, replacing the review's twelve near-duplicate dead-end lines ──
export { default as EmptyState } from './EmptyState.svelte';
export { default as ErrorState } from './ErrorState.svelte';
export {
	errorKind,
	errorSeverity,
	hasExplanation,
	type ErrorKind,
	type ErrorSeverity
} from './error-status';

// ── keyboard hints — a styled <kbd> for shortcut hints, never bare text ──
export { default as KeyboardHint } from './KeyboardHint.svelte';

// ── metrics — a compact stat tile, no chart chrome ───────────────────────
export { default as StatTile } from './StatTile.svelte';

// ── notices — an in-context warning/critical/info banner, icon plus prose
// plus an optional way forward; see banner.ts for why tone never carries
// the meaning alone ──
export { default as Banner } from './Banner.svelte';
export { BANNER_TONES, bannerGlyph, bannerRole, type BannerTone } from './banner';

// ── navigation — a row of links that switch which slice of one list is
// showing; real URLs, not a same-page panel swap (see Tabs.svelte) ───────
export { default as Tabs } from './Tabs.svelte';
