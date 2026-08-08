<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { formatMinorUnits, formatMonth, formatMonthShort } from '$lib/i18n/format';
	import { Axis, ChartFrame, Grid, Legend, Tooltip } from '$lib/design';
	import type { SeriesEntry, TableColumn, TooltipRow } from '$lib/design';
	import {
		CASH_CALENDAR_TIER,
		type CashCalendarMarker,
		type CashCalendarMonth,
		cashCalendarYTicks,
		markerLabel
	} from './cash-calendar';
	import { renewalAssumptionLine, type RenewalAssumptionContribution } from './renewal-assumption';
	import { addMinorUnits, NO_MINOR_UNITS, type MinorUnits } from '$lib/money';

	let {
		months,
		to,
		markers,
		assumptions = []
	}: {
		months: readonly CashCalendarMonth[];
		/** The window's own exclusive end — the last bucket's own boundary,
		 * needed to place a marker that falls in the final month. */
		to: string;
		markers: readonly CashCalendarMarker[];
		/** #127: every recorded renewal assumption contributing to a
		 * `projected` figure somewhere in this window — empty by default
		 * for a caller (a test, a story) that has none to show. A month's
		 * own `projected.amount` is `certainty.ts`'s `projectedAmount`,
		 * which folds a contributing assumption in directly (never a
		 * negative figure), so "this month's projected amount is above
		 * zero" is already the exact, non-recomputed condition under which
		 * one of these could be part of it — not a guess. */
		assumptions?: readonly RenewalAssumptionContribution[];
	} = $props();

	// See `+page.server.ts`'s header comment: the fiscal engine carries no
	// currency of its own, so every figure here is read as EUR.
	const CURRENCY = 'EUR';

	const barWidth = 28;
	const barGap = 16;
	const plotHeight = 180;
	const plotWidth = $derived(months.length * (barWidth + barGap) - barGap);
	const yMax = $derived(
		Math.max(
			1,
			...months.map(
				(month) => month.collected.amount + month.committed.amount + month.projected.amount
			)
		) * 1.1
	);
	const yTickValues = $derived(cashCalendarYTicks(yMax));
	function yScale(amount: number): number {
		return plotHeight - (amount / yMax) * plotHeight;
	}

	function stack(month: CashCalendarMonth) {
		const collectedTop = yScale(month.collected.amount);
		const committedTop = yScale(month.collected.amount + month.committed.amount);
		const projectedTop = yScale(
			month.collected.amount + month.committed.amount + month.projected.amount
		);
		return {
			collected: { top: collectedTop, height: plotHeight - collectedTop },
			committed: { top: committedTop, height: collectedTop - committedTop },
			projected: { top: projectedTop, height: committedTop - projectedTop }
		};
	}

	function daysInMonth(monthStart: string): number {
		const [year, monthNum] = monthStart.split('-').map(Number);
		return new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
	}

	function boundaryAfter(index: number): string {
		return months[index + 1]?.month ?? to;
	}

	function monthIndexOf(date: string): number {
		return months.findIndex((month, index) => date >= month.month && date < boundaryAfter(index));
	}

	function markerX(marker: CashCalendarMarker): number | null {
		const index = monthIndexOf(marker.date);
		if (index === -1) return null;
		const dayOfMonth = Number(marker.date.slice(8, 10));
		const fraction = (dayOfMonth - 1) / daysInMonth(months[index].month);
		return index * (barWidth + barGap) + fraction * barWidth;
	}

	const markerDashArray: Record<CashCalendarMarker['kind'], string | undefined> = {
		contract_expiry: undefined,
		renewal_window: '4 3',
		irrevocability_edge: '1 3'
	};

	interface MonthRow {
		month: string;
		collected: MinorUnits;
		committed: MinorUnits;
		projected: MinorUnits;
		total: MinorUnits;
		assumptionsText: string;
		markers: string;
	}
	const rows = $derived<MonthRow[]>(
		months.map((month, index) => {
			const boundary = boundaryAfter(index);
			const monthMarkers = markers.filter(
				(marker) => marker.date >= month.month && marker.date < boundary
			);
			return {
				month: month.month,
				collected: month.collected.amount,
				committed: month.committed.amount,
				projected: month.projected.amount,
				total: addMinorUnits(
					month.collected.amount,
					month.committed.amount,
					month.projected.amount
				),
				// See the `assumptions` prop doc comment: gated on this exact
				// month's own projected figure being above zero, the one
				// condition already computed upstream that means one of
				// these could be folded into it.
				assumptionsText:
					month.projected.amount > 0 && assumptions.length > 0
						? assumptions.map(renewalAssumptionLine).join(' ')
						: '',
				markers: monthMarkers.map(markerLabel).join('; ')
			};
		})
	);
	const columns: TableColumn<MonthRow>[] = [
		{
			key: 'month',
			label: m.dashboard_cash_calendar_column_month(),
			format: (r) => formatMonth(r.month)
		},
		{
			key: 'collected',
			label: m.dashboard_cash_calendar_column_collected(),
			align: 'end',
			format: (r) => formatMinorUnits(r.collected, CURRENCY)
		},
		{
			key: 'committed',
			label: m.dashboard_cash_calendar_column_committed(),
			align: 'end',
			format: (r) => formatMinorUnits(r.committed, CURRENCY)
		},
		{
			key: 'projected',
			label: m.dashboard_cash_calendar_column_projected(),
			align: 'end',
			format: (r) => formatMinorUnits(r.projected, CURRENCY)
		},
		{ key: 'assumptionsText', label: m.dashboard_cash_calendar_column_assumptions() },
		{
			key: 'total',
			label: m.dashboard_cash_calendar_column_total(),
			align: 'end',
			format: (r) => formatMinorUnits(r.total, CURRENCY)
		},
		{ key: 'markers', label: m.dashboard_cash_calendar_column_markers() }
	];

	const tierEntries: SeriesEntry[] = [
		{
			id: 'collected',
			label: m.dashboard_cash_calendar_tier_collected(),
			color: `var(--certainty-${CASH_CALENDAR_TIER.collected})`,
			mark: 'rect'
		},
		{
			id: 'committed',
			label: m.dashboard_cash_calendar_tier_committed(),
			color: `var(--certainty-${CASH_CALENDAR_TIER.committed})`,
			mark: 'rect'
		},
		{
			id: 'projected',
			label: m.dashboard_cash_calendar_tier_projected(),
			color: `var(--certainty-${CASH_CALENDAR_TIER.projected})`,
			mark: 'rect'
		}
	];

	let tooltip: { x: number; y: number; rows: TooltipRow[] } | null = $state(null);
	function showMonthTooltip(month: CashCalendarMonth, event: { currentTarget: SVGElement }) {
		const box = (event.currentTarget as SVGGraphicsElement).getBoundingClientRect();
		const parent = (event.currentTarget as SVGElement)
			.closest('.plot-wrap')
			?.getBoundingClientRect();
		if (!parent) return;
		tooltip = {
			x: box.left - parent.left + box.width / 2,
			y: box.top - parent.top,
			rows: [
				{
					label: m.dashboard_cash_calendar_tier_collected(),
					value: formatMinorUnits(month.collected.amount, CURRENCY),
					color: `var(--certainty-${CASH_CALENDAR_TIER.collected})`
				},
				{
					label: m.dashboard_cash_calendar_tier_committed(),
					value: formatMinorUnits(month.committed.amount, CURRENCY),
					color: `var(--certainty-${CASH_CALENDAR_TIER.committed})`
				},
				{
					label: m.dashboard_cash_calendar_tier_projected(),
					value: formatMinorUnits(month.projected.amount, CURRENCY),
					color: `var(--certainty-${CASH_CALENDAR_TIER.projected})`
				}
			]
		};
	}
	function showMarkerTooltip(marker: CashCalendarMarker, event: { currentTarget: SVGElement }) {
		const box = (event.currentTarget as SVGGraphicsElement).getBoundingClientRect();
		const parent = (event.currentTarget as SVGElement)
			.closest('.plot-wrap')
			?.getBoundingClientRect();
		if (!parent) return;
		tooltip = {
			x: box.left - parent.left + box.width / 2,
			y: box.top - parent.top,
			rows: [{ label: formatMonth(marker.date.slice(0, 7) + '-01'), value: markerLabel(marker) }]
		};
	}
	function hideTooltip() {
		tooltip = null;
	}
</script>

<!--
	#64: the twelve-bar chart below is native-sized SVG (see `.plot-wrap
	svg`'s own comment) — exactly the shape that forces horizontal
	scrolling at a phone width, and `ChartFrame`'s own chart/table toggle
	does not save it, because the table twin still carries four
	non-wrapping currency columns side by side. Below 640px (Tailwind's
	own `sm`, the same breakpoint `ChartFrame` itself now defaults to a
	table at) this replaces both with a dedicated vertical list: one row
	per month, full width, no column that cannot wrap — a genuine
	different orientation, not a lesser fallback. Both trees render always
	and a media query picks one, so there is no client-only branch to
	flash or desync from the server-rendered markup.
-->
<div class="calendar-desktop">
	<ChartFrame
		title={m.dashboard_cash_calendar_title()}
		caption={m.dashboard_cash_calendar_caption()}
		{columns}
		{rows}
	>
		{#snippet chart()}
			<div class="plot-wrap">
				<svg
					viewBox="-56 -8 {plotWidth + 64} {plotHeight + 40}"
					width={plotWidth + 64}
					height={plotHeight + 40}
					role="img"
					aria-label={m.dashboard_cash_calendar_title()}
				>
					<Grid orientation="horizontal" lines={yTickValues.map(yScale)} length={plotWidth} />
					{#each months as month, index (month.month)}
						{@const segments = stack(month)}
						{@const x = index * (barWidth + barGap)}
						<g
							tabindex="0"
							role="button"
							aria-label="{formatMonth(month.month)}: {formatMinorUnits(
								segments.collected.height > 0 ? month.collected.amount : NO_MINOR_UNITS,
								CURRENCY
							)}"
							onpointermove={(e) => showMonthTooltip(month, e)}
							onfocus={(e) => showMonthTooltip(month, e)}
							onpointerleave={hideTooltip}
							onblur={hideTooltip}
						>
							<rect
								{x}
								y={segments.collected.top}
								width={barWidth}
								height={segments.collected.height}
								style:fill="var(--certainty-{CASH_CALENDAR_TIER.collected})"
							/>
							<rect
								{x}
								y={segments.committed.top}
								width={barWidth}
								height={segments.committed.height}
								style:fill="var(--certainty-{CASH_CALENDAR_TIER.committed})"
								style:stroke="var(--surface-1)"
								style:stroke-width="1"
							/>
							<rect
								{x}
								y={segments.projected.top}
								width={barWidth}
								height={segments.projected.height}
								style:fill="var(--certainty-{CASH_CALENDAR_TIER.projected})"
								style:stroke="var(--surface-1)"
								style:stroke-width="1"
							/>
						</g>
					{/each}
					{#each markers as marker (marker.contractId + marker.kind + marker.date)}
						{@const x = markerX(marker)}
						{#if x !== null}
							<line
								x1={x}
								y1={-4}
								x2={x}
								y2={plotHeight}
								class="marker-line"
								stroke-dasharray={markerDashArray[marker.kind]}
								tabindex="0"
								role="button"
								aria-label={markerLabel(marker)}
								onpointermove={(e) => showMarkerTooltip(marker, e)}
								onfocus={(e) => showMarkerTooltip(marker, e)}
								onpointerleave={hideTooltip}
								onblur={hideTooltip}
							/>
						{/if}
					{/each}
					<Axis
						orientation="y"
						length={plotHeight}
						ticks={yTickValues.map((v) => ({
							position: yScale(v),
							label: formatMinorUnits(v, CURRENCY)
						}))}
					/>
					<g transform="translate(0, {plotHeight})">
						<Axis
							orientation="x"
							length={plotWidth}
							ticks={months.map((month, index) => ({
								position: index * (barWidth + barGap) + barWidth / 2,
								label: formatMonthShort(month.month)
							}))}
						/>
					</g>
				</svg>
				{#if tooltip}
					<Tooltip x={tooltip.x} y={tooltip.y} rows={tooltip.rows} />
				{/if}
			</div>
			<Legend entries={tierEntries} />
			<p class="marker-key">{m.dashboard_cash_calendar_marker_key()}</p>
		{/snippet}
	</ChartFrame>
</div>

<div class="calendar-phone">
	<div class="phone-card">
		<h3>{m.dashboard_cash_calendar_title()}</h3>
		<p class="phone-caption">{m.dashboard_cash_calendar_caption()}</p>
		<ul class="phone-months" aria-label={m.dashboard_cash_calendar_phone_list_label()}>
			{#each rows as row (row.month)}
				<li class="phone-month">
					<div class="phone-month-head">
						<span class="phone-month-label">{formatMonth(row.month)}</span>
						<span class="phone-month-total">{formatMinorUnits(row.total, CURRENCY)}</span>
					</div>
					<div
						class="phone-month-bar"
						role="img"
						aria-label={m.dashboard_cash_calendar_month_summary({
							month: formatMonth(row.month),
							collected: formatMinorUnits(row.collected, CURRENCY),
							committed: formatMinorUnits(row.committed, CURRENCY),
							projected: formatMinorUnits(row.projected, CURRENCY)
						})}
					>
						<span
							class="segment"
							style:width="{(row.collected / yMax) * 100}%"
							style:background="var(--certainty-{CASH_CALENDAR_TIER.collected})"
						></span>
						<span
							class="segment"
							style:width="{(row.committed / yMax) * 100}%"
							style:background="var(--certainty-{CASH_CALENDAR_TIER.committed})"
						></span>
						<span
							class="segment"
							style:width="{(row.projected / yMax) * 100}%"
							style:background="var(--certainty-{CASH_CALENDAR_TIER.projected})"
						></span>
					</div>
					{#if row.markers}<p class="phone-month-note">{row.markers}</p>{/if}
					{#if row.assumptionsText}<p class="phone-month-note">{row.assumptionsText}</p>{/if}
				</li>
			{/each}
		</ul>
		<Legend entries={tierEntries} />
		<p class="marker-key">{m.dashboard_cash_calendar_marker_key()}</p>
	</div>
</div>

{#if assumptions.length > 0}
	<div class="assumptions-summary">
		<p class="assumptions-heading">{m.dashboard_assumptions_heading()}</p>
		<ul>
			{#each assumptions as assumption (assumption.contractId)}
				<li>{renewalAssumptionLine(assumption)}</li>
			{/each}
		</ul>
	</div>
{/if}

<style>
	.plot-wrap {
		position: relative;
	}
	.plot-wrap svg {
		/* Tailwind's preflight sets `svg { max-width: 100% }`, which would
		   shrink this chart to fit its container instead of letting
		   ChartFrame's own `overflow-x: auto` scroll it at native size. */
		max-width: none;
	}
	.marker-line {
		stroke: var(--text-muted);
		stroke-width: 1.5;
		cursor: pointer;
	}
	.marker-line:focus-visible {
		stroke: var(--text-primary);
		outline: none;
	}
	.marker-key {
		margin: 0.625rem 0 0;
		color: var(--text-muted);
		font-size: 0.75rem;
	}

	.calendar-phone {
		display: none;
	}
	.phone-card {
		background: var(--surface-1);
		border: 1px solid var(--border-hairline);
		border-radius: 8px;
		padding: 1rem;
	}
	.phone-card h3 {
		margin: 0;
		color: var(--text-primary);
		font-size: 0.9375rem;
		font-weight: 600;
	}
	.phone-caption {
		margin: 0.25rem 0 0;
		color: var(--text-secondary);
		font-size: 0.8125rem;
	}
	.phone-months {
		margin: 0.875rem 0 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.phone-month {
		padding-bottom: 0.75rem;
		border-bottom: 1px solid var(--grid-line);
	}
	.phone-month:last-child {
		padding-bottom: 0;
		border-bottom: none;
	}
	.phone-month-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.phone-month-label {
		color: var(--text-primary);
		font-size: 0.875rem;
		font-weight: 600;
	}
	.phone-month-total {
		color: var(--text-primary);
		font-size: 0.875rem;
		font-variant-numeric: tabular-nums;
	}
	.phone-month-bar {
		margin-top: 0.375rem;
		display: flex;
		height: 0.75rem;
		border-radius: 4px;
		background: var(--grid-line);
		overflow: hidden;
	}
	.phone-month-bar .segment {
		height: 100%;
	}
	.phone-month-note {
		margin: 0.375rem 0 0;
		color: var(--text-muted);
		font-size: 0.75rem;
		overflow-wrap: anywhere;
	}

	.assumptions-summary {
		margin-top: 0.875rem;
		padding: 0.75rem 1rem;
		background: var(--surface-1);
		border: 1px solid var(--border-hairline);
		border-radius: 8px;
	}
	.assumptions-heading {
		margin: 0;
		color: var(--text-secondary);
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.02em;
	}
	.assumptions-summary ul {
		margin: 0.5rem 0 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}
	.assumptions-summary li {
		color: var(--text-primary);
		font-size: 0.8125rem;
		overflow-wrap: anywhere;
	}

	@media (max-width: 640px) {
		.calendar-desktop {
			display: none;
		}
		.calendar-phone {
			display: block;
		}
	}
</style>
