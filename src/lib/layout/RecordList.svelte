<script lang="ts" generics="Row">
	import { appHref } from '$lib/nav/href';
	import Card from './Card.svelte';
	import { assertUniqueColumnKeys, type RecordColumn } from './types';

	let {
		columns,
		rows,
		caption,
		rowKey,
		rowHref
	}: {
		columns: readonly RecordColumn<Row>[];
		rows: readonly Row[];
		/** Names the table for a screen reader when a visible heading already sits above it. */
		caption: string;
		rowKey: (row: Row) => string;
		/** When a row leads somewhere, the first cell becomes the link rather than a separate "view" column. */
		rowHref?: (row: Row) => string;
	} = $props();

	assertUniqueColumnKeys(columns);

	const cell = (row: Row, column: RecordColumn<Row>) =>
		column.format ? column.format(row) : String((row as Record<string, unknown>)[column.key] ?? '');
</script>

<!-- Both renderings are in the DOM and CSS picks. Swapping them on
     matchMedia instead would need JavaScript and would flash on hydration,
     and these lists are a handful of rows. -->
<table class="table">
	<caption class="sr-only">{caption}</caption>
	<thead>
		<tr>
			{#each columns as column (column.key)}
				<th scope="col" class:end={column.align === 'end'}>{column.label}</th>
			{/each}
		</tr>
	</thead>
	<tbody>
		{#each rows as row (rowKey(row))}
			<tr>
				{#each columns as column, index (column.key)}
					<td class:end={column.align === 'end'}>
						{#if index === 0 && rowHref}
							<a href={appHref(rowHref(row))}>{cell(row, column)}</a>
						{:else}
							{cell(row, column)}
						{/if}
					</td>
				{/each}
			</tr>
		{/each}
	</tbody>
</table>

<ul class="cards">
	{#each rows as row (rowKey(row))}
		<li>
			<Card>
				<p class="title">
					{#if rowHref}
						<a href={appHref(rowHref(row))}>{cell(row, columns[0])}</a>
					{:else}
						{cell(row, columns[0])}
					{/if}
				</p>
				<dl>
					{#each columns.slice(1) as column (column.key)}
						<div class="pair">
							<dt>{column.label}</dt>
							<dd>{cell(row, column)}</dd>
						</div>
					{/each}
				</dl>
			</Card>
		</li>
	{/each}
</ul>

<style>
	.table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.875rem;
	}
	th,
	td {
		padding: 0.5rem 0.75rem 0.5rem 0;
		text-align: start;
		font-variant-numeric: tabular-nums;
		border-bottom: 1px solid var(--border-hairline);
	}
	th {
		color: var(--text-secondary);
		font-weight: 600;
	}
	.end {
		text-align: end;
	}
	.cards {
		display: none;
		flex-direction: column;
		gap: 0.5rem;
		list-style: none;
		padding: 0;
	}
	.title {
		font-weight: 600;
	}
	dl {
		margin: 0.5rem 0 0;
		font-size: 0.875rem;
	}
	.pair {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.125rem 0;
	}
	dt {
		color: var(--text-secondary);
	}
	dd {
		margin: 0;
		font-variant-numeric: tabular-nums;
		text-align: end;
	}
	@media (max-width: 639px) {
		.table {
			display: none;
		}
		.cards {
			display: flex;
		}
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
