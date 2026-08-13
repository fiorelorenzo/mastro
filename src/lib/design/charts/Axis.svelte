<script lang="ts">
	import type { AxisTick } from './types';

	let {
		orientation,
		ticks,
		length,
		tickLength = 4
	}: {
		/** `x` draws a horizontal baseline with ticks dropping down; `y` a vertical one with ticks to the left. */
		orientation: 'x' | 'y';
		ticks: readonly AxisTick[];
		/** Length of the baseline in px. */
		length: number;
		tickLength?: number;
	} = $props();

	// #235: the month axis used to draw every label at a fixed pitch with
	// no collision handling, producing a single unreadable run
	// ("feb 2026mar 2026…") the instant the pitch was tighter than the
	// labels — true at every width this chart shipped at. Rather than a
	// per-chart workaround, the fix lives here, generically: estimate
	// each label's rendered width from its character count (this axis
	// always draws `.label` at the fixed 11px below), and when the
	// tightest gap between two adjacent ticks can't fit the widest label,
	// keep only every Nth one — always including the last tick, so the
	// most recent/current entry never silently drops. Tick *lines* still
	// draw for every entry; only the text can be skipped, so the axis
	// never implies fewer data points than it has. Y-axis labels stack
	// vertically with far more headroom (a handful of ticks over a whole
	// plot height) and are left alone.
	const AVG_CHAR_WIDTH = 6.2;
	const LABEL_PADDING = 6;
	function estimatedLabelWidth(label: string): number {
		return label.length * AVG_CHAR_WIDTH + LABEL_PADDING;
	}

	const labelStep = $derived.by(() => {
		if (orientation !== 'x' || ticks.length < 2) return 1;
		const widest = Math.max(...ticks.map((tick) => estimatedLabelWidth(tick.label)));
		const tightestPitch = Math.min(
			...ticks.slice(1).map((tick, i) => tick.position - ticks[i].position)
		);
		if (tightestPitch <= 0) return ticks.length; // degenerate: keep only the first
		return Math.max(1, Math.ceil(widest / tightestPitch));
	});
	function labelVisible(index: number): boolean {
		return index % labelStep === 0 || index === ticks.length - 1;
	}
</script>

<!--
	Ticks are keyed by index, not by label. A tick has no identity beyond
	where it sits on the axis, and two labels can legitimately be equal on a
	degenerate range (an instance with no data yet) — keyed by label that
	threw each_key_duplicate mid-hydration and left the whole page blank
	(#143). An axis is redrawn wholesale anyway; there is nothing to
	preserve across a reorder.

	Hairline axis: solid 1px baseline plus one tick per label, never dashed
	(dashing reads as "projection" elsewhere in this system, see
	marks-and-anatomy.md). Values also live in every chart's table view, so
	this is a navigation aid, not the only way to read a position.
-->
<g class="axis axis-{orientation}">
	{#if orientation === 'x'}
		<line class="baseline" x1="0" y1="0" x2={length} y2="0" />
		{#each ticks as tick, i (i)}
			<line class="tick" x1={tick.position} y1="0" x2={tick.position} y2={tickLength} />
			{#if labelVisible(i)}
				<text class="label" x={tick.position} y={tickLength + 12} text-anchor="middle"
					>{tick.label}</text
				>
			{/if}
		{/each}
	{:else}
		<line class="baseline" x1="0" y1="0" x2="0" y2={length} />
		{#each ticks as tick, i (i)}
			<line class="tick" x1={-tickLength} y1={tick.position} x2="0" y2={tick.position} />
			<text
				class="label"
				x={-tickLength - 4}
				y={tick.position}
				dominant-baseline="middle"
				text-anchor="end"
			>
				{tick.label}
			</text>
		{/each}
	{/if}
</g>

<style>
	.baseline,
	.tick {
		stroke: var(--axis-line);
		stroke-width: 1;
		shape-rendering: crispEdges;
	}
	.label {
		fill: var(--text-muted);
		font-size: 11px;
		font-variant-numeric: tabular-nums;
	}
</style>
