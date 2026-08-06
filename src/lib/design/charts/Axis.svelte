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
</script>

<!--
	Hairline axis: solid 1px baseline plus one tick per label, never dashed
	(dashing reads as "projection" elsewhere in this system, see
	marks-and-anatomy.md). Values also live in every chart's table view, so
	this is a navigation aid, not the only way to read a position.
-->
<g class="axis axis-{orientation}">
	{#if orientation === 'x'}
		<line class="baseline" x1="0" y1="0" x2={length} y2="0" />
		{#each ticks as tick (tick.label)}
			<line class="tick" x1={tick.position} y1="0" x2={tick.position} y2={tickLength} />
			<text class="label" x={tick.position} y={tickLength + 12} text-anchor="middle"
				>{tick.label}</text
			>
		{/each}
	{:else}
		<line class="baseline" x1="0" y1="0" x2="0" y2={length} />
		{#each ticks as tick (tick.label)}
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
