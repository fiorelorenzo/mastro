<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { formatMinorUnits, formatMonth, formatMonthShort } from '$lib/i18n/format';
	import { Axis, ChartFrame, Grid, Legend, Tooltip } from '$lib/design';
	import type { SeriesEntry, TableColumn, TooltipRow } from '$lib/design';
	import {
		CASH_CALENDAR_TIER,
		markerLabel,
		type CashCalendarMarker,
		type CashCalendarMonth
	} from './cash-calendar';

	let {
		months,
		to,
		markers
	}: {
		months: readonly CashCalendarMonth[];
		/** The window's own exclusive end — the last bucket's own boundary,
		 * needed to place a marker that falls in the final month. */
		to: string;
		markers: readonly CashCalendarMarker[];
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
	const yTickValues = $derived([0, yMax / 2, yMax]);
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
		collected: number;
		committed: number;
		projected: number;
		total: number;
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
				total: month.collected.amount + month.committed.amount + month.projected.amount,
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
							segments.collected.height > 0 ? month.collected.amount : 0,
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
</style>
