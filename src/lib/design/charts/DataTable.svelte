<script lang="ts" generics="Row">
	import type { TableColumn } from './types';

	let {
		columns,
		rows,
		caption
	}: {
		columns: readonly TableColumn<Row>[];
		rows: readonly Row[];
		/** Visually hidden — names the table for screen readers when a visible title already sits above it. */
		caption?: string;
	} = $props();
</script>

<table>
	{#if caption}<caption class="sr-only">{caption}</caption>{/if}
	<thead>
		<tr>
			{#each columns as column (column.key)}
				<th scope="col" class:text-end={column.align === 'end'}>{column.label}</th>
			{/each}
		</tr>
	</thead>
	<tbody>
		{#each rows as row, i (i)}
			<tr>
				{#each columns as column (column.key)}
					<td class:text-end={column.align === 'end'}>
						{column.format ? column.format(row) : String(row[column.key])}
					</td>
				{/each}
			</tr>
		{/each}
	</tbody>
</table>

<style>
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.8125rem;
	}
	th,
	td {
		padding: 0.5rem 0.75rem;
		text-align: start;
		font-variant-numeric: tabular-nums;
		border-bottom: 1px solid var(--grid-line);
	}
	.text-end {
		text-align: end;
	}
	th {
		color: var(--text-secondary);
		font-weight: 600;
	}
	td {
		color: var(--text-primary);
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
</style>
