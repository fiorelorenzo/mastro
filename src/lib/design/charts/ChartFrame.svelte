<script lang="ts" generics="Row">
	import type { Snippet } from 'svelte';
	import DataTable from './DataTable.svelte';
	import type { TableColumn } from './types';

	let {
		title,
		caption,
		columns,
		rows,
		chart
	}: {
		title: string;
		caption?: string;
		/**
		 * Required, not optional: a `ChartFrame` cannot be built without the
		 * data needed to render its table twin, so a chart can never ship as
		 * the only way to read the data — see components.md, "table-view
		 * toggle".
		 */
		columns: readonly TableColumn<Row>[];
		rows: readonly Row[];
		chart: Snippet;
	} = $props();

	let view: 'chart' | 'table' = $state('chart');
</script>

<figure class="chart-frame">
	<figcaption>
		<div class="heading">
			<h3>{title}</h3>
			<div class="view-toggle" role="group" aria-label="Chart or table view">
				<button type="button" class:active={view === 'chart'} onclick={() => (view = 'chart')}>
					Chart
				</button>
				<button type="button" class:active={view === 'table'} onclick={() => (view = 'table')}>
					Table
				</button>
			</div>
		</div>
		{#if caption}<p class="caption">{caption}</p>{/if}
	</figcaption>
	<div class="body">
		{#if view === 'chart'}
			{@render chart()}
		{:else}
			<DataTable {columns} {rows} caption={title} />
		{/if}
	</div>
</figure>

<style>
	.chart-frame {
		margin: 0;
		background: var(--surface-1);
		border: 1px solid var(--border-hairline);
		border-radius: 8px;
		padding: 1rem;
	}
	.heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}
	h3 {
		margin: 0;
		color: var(--text-primary);
		font-size: 0.9375rem;
		font-weight: 600;
	}
	.caption {
		margin: 0.25rem 0 0;
		color: var(--text-secondary);
		font-size: 0.8125rem;
	}
	.view-toggle {
		display: inline-flex;
		border: 1px solid var(--border-hairline);
		border-radius: 6px;
		overflow: hidden;
	}
	.view-toggle button {
		border: none;
		background: none;
		padding: 0.25rem 0.625rem;
		color: var(--text-secondary);
		font: inherit;
		font-size: 0.75rem;
		cursor: pointer;
	}
	.view-toggle button.active {
		background: var(--text-primary);
		color: var(--surface-1);
	}
	.body {
		margin-top: 0.875rem;
		/* Fixed height includes the axis band: the plot area grows with its
		   content instead of clipping tick labels into a nested scroll. */
		overflow-x: auto;
	}
</style>
