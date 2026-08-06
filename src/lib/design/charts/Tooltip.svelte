<script lang="ts">
	import type { TooltipRow } from './types';

	let {
		x,
		y,
		rows
	}: {
		/** Position in px, relative to the chart's own `position: relative` ancestor. */
		x: number;
		y: number;
		rows: readonly TooltipRow[];
	} = $props();
</script>

<!--
	Enhances, never gates: every value shown here also lives in the table
	view (ChartFrame) and, where the chart directly labels it, on the mark
	itself. Row labels/values are untrusted data and go through Svelte text
	interpolation (equivalent to textContent), never innerHTML.
-->
<div class="tooltip" role="status" style:left="{x}px" style:top="{y}px">
	{#each rows as row (row.label)}
		<div class="row">
			{#if row.color}
				<span class="key" style:background={row.color}></span>
			{/if}
			<span class="row-label">{row.label}</span>
			<span class="row-value">{row.value}</span>
		</div>
	{/each}
</div>

<style>
	.tooltip {
		position: absolute;
		transform: translate(-50%, -100%) translateY(-8px);
		pointer-events: none;
		background: var(--surface-1);
		border: 1px solid var(--border-hairline);
		border-radius: 6px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
		padding: 0.5rem 0.625rem;
		min-width: 8rem;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.8125rem;
		white-space: nowrap;
	}
	.row + .row {
		margin-top: 0.25rem;
	}
	.key {
		flex: none;
		width: 10px;
		height: 2px;
	}
	.row-label {
		color: var(--text-secondary);
	}
	.row-value {
		margin-left: auto;
		padding-left: 0.75rem;
		color: var(--text-primary);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
</style>
