<script lang="ts" generics="Row">
	import { onMount } from 'svelte';
	import type { Snippet } from 'svelte';
	import * as m from '$lib/paraglide/messages';
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

	// #64: a chart drawn to its own native size (every chart here scrolls
	// its SVG rather than squashing it illegibly) is exactly what forces
	// horizontal scrolling at a phone width. Below the same breakpoint
	// Tailwind's own `sm`, this defaults the toggle to the table — no
	// horizontal scroll a table's wrapping text and shrinking columns
	// cannot already handle — while a manual pick (either direction)
	// always wins once made, including across a later resize.
	const PHONE_WIDTH_QUERY = '(max-width: 640px)';
	let view: 'chart' | 'table' = $state('chart');
	let userPickedView = false;

	function pickView(next: 'chart' | 'table') {
		userPickedView = true;
		view = next;
	}

	onMount(() => {
		const query = window.matchMedia(PHONE_WIDTH_QUERY);
		const applyDefault = () => {
			if (!userPickedView) view = query.matches ? 'table' : 'chart';
		};
		applyDefault();
		query.addEventListener('change', applyDefault);
		return () => query.removeEventListener('change', applyDefault);
	});
</script>

<figure class="chart-frame">
	<figcaption>
		<div class="heading">
			<h3>{title}</h3>
			<div class="view-toggle" role="group" aria-label={m.chart_frame_toggle_group_label()}>
				<button type="button" class:active={view === 'chart'} onclick={() => pickView('chart')}>
					{m.chart_frame_view_chart()}
				</button>
				<button type="button" class:active={view === 'table'} onclick={() => pickView('table')}>
					{m.chart_frame_view_table()}
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
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: none;
		background: none;
		min-width: 2.75rem;
		min-height: 2.75rem;
		padding: 0.5rem 0.875rem;
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
	@media (max-width: 480px) {
		.chart-frame {
			padding: 0.625rem;
		}
	}
</style>
