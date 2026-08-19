<!--
  Table: RecordList's successor. Same trick — one column definition drives
  both a desktop <table> and a mobile card list, both in the DOM so CSS
  (not JS) picks which one shows and nothing flashes at hydration — but
  adds what RecordList could not do: sort, a rich cell (a badge, a link, an
  Amount), and an empty state a caller cannot forget to pass.

  `empty` has no default. RecordList rendered a <table> with a header row
  and nothing under it, and a <ul> with nothing in it, for a `rows` of
  length zero — indistinguishable from a page that failed to load. Making
  `empty` a required snippet moves that failure to a type error.

  RecordList stays exactly as it is; #204 tracks migrating its eight
  callers here.
-->
<script lang="ts" generics="Row">
	import type { Snippet } from 'svelte';
	import * as m from '$lib/paraglide/messages';
	import { appHref } from '$lib/nav/href';
	import { assertUniqueColumnKeys } from '$lib/layout/types';
	import Card from '$lib/layout/Card.svelte';
	import {
		sortRows,
		tableAriaSort,
		toggleTableSort,
		type TableColumn,
		type TableSort
	} from './table';

	let {
		columns,
		rows,
		caption,
		rowKey,
		rowHref,
		empty,
		density = 'comfortable'
	}: {
		columns: readonly TableColumn<Row>[];
		rows: readonly Row[];
		/** Names the table for a screen reader when a visible heading already sits above it. */
		caption: string;
		rowKey: (row: Row) => string;
		/** When a row leads somewhere, the first cell becomes the link rather than a separate "view" column. */
		rowHref?: (row: Row) => string;
		/** Rendered instead of the table/card duality when `rows` is empty. No default — a list with no empty state is a bug, not a style choice. */
		empty: Snippet;
		density?: 'comfortable' | 'compact';
	} = $props();

	assertUniqueColumnKeys(columns);

	let sort = $state<TableSort | null>(null);

	const sortedRows = $derived(sortRows(rows, columns, sort));

	function sortIcon(state: 'ascending' | 'descending' | 'none'): string {
		if (state === 'ascending') return '▲';
		if (state === 'descending') return '▼';
		return '↕';
	}

	// Screen readers get the sort state from `aria-sort` on the header cell
	// itself, but that alone goes unannounced in several readers unless
	// focus moves off the cell and back — this is the one `aria-live`
	// region the mockup's target has none of. It exists only once, updated
	// in place, rather than one per header, so consecutive sorts don't
	// queue up stale announcements.
	const sortAnnouncement = $derived.by(() => {
		if (!sort) return '';
		const active = sort;
		const column = columns.find((candidate) => candidate.key === active.key);
		const label = column?.label ?? '';
		return active.direction === 'asc'
			? m.design_table_sorted_ascending({ column: label })
			: m.design_table_sorted_descending({ column: label });
	});
</script>

{#snippet cellContent(row: Row, column: TableColumn<Row>)}
	{#if column.cell}
		{@render column.cell(row)}
	{:else}
		{column.format
			? column.format(row)
			: String((row as Record<string, unknown>)[column.key] ?? '')}
	{/if}
{/snippet}

{#if rows.length === 0}
	{@render empty()}
{:else}
	<p class="sr-only" aria-live="polite">{sortAnnouncement}</p>

	<table class="table" class:compact={density === 'compact'}>
		<caption class="sr-only">{caption}</caption>
		<thead>
			<tr>
				{#each columns as column (column.key)}
					{@const state = column.sort ? tableAriaSort(sort, column.key) : 'none'}
					<th
						scope="col"
						class:end={column.align === 'end'}
						aria-sort={column.sort ? state : undefined}
					>
						{#if column.sort}
							<button
								type="button"
								class="sort"
								onclick={() => (sort = toggleTableSort(sort, column.key))}
							>
								{column.label}
								<span class="sort-icon" aria-hidden="true">{sortIcon(state)}</span>
							</button>
						{:else}
							{column.label}
						{/if}
					</th>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#each sortedRows as row (rowKey(row))}
				<tr>
					{#each columns as column, index (column.key)}
						<td class:end={column.align === 'end'} class:tabular={column.align === 'end'}>
							{#if index === 0 && rowHref}
								<a href={appHref(rowHref(row))}>{@render cellContent(row, column)}</a>
							{:else}
								{@render cellContent(row, column)}
							{/if}
						</td>
					{/each}
				</tr>
			{/each}
		</tbody>
	</table>

	<ul class="cards" class:compact={density === 'compact'}>
		{#each sortedRows as row (rowKey(row))}
			<li>
				<Card>
					<p class="title">
						{#if rowHref}
							<a href={appHref(rowHref(row))}>{@render cellContent(row, columns[0])}</a>
						{:else}
							{@render cellContent(row, columns[0])}
						{/if}
					</p>
					<dl>
						{#each columns.slice(1) as column (column.key)}
							<div class="pair">
								<dt>{column.label}</dt>
								<dd class:end={column.align === 'end'} class:tabular={column.align === 'end'}>
									{@render cellContent(row, column)}
								</dd>
							</div>
						{/each}
					</dl>
				</Card>
			</li>
		{/each}
	</ul>
{/if}

<style>
	/* Row heights come from the density prop, not two near-duplicate
	   stylesheets: a table, a list and a form all read "a row" off the same
	   two tokens (tokens.css), so a table can match whatever density its
	   page already committed to. */
	.table {
		--row-height: var(--row-comfortable);
		width: 100%;
		border-collapse: collapse;
		font-size: var(--text-sm);
	}
	.table.compact {
		--row-height: var(--row-compact);
	}
	th,
	td {
		padding: var(--space-2) var(--space-3) var(--space-2) 0;
		text-align: start;
	}
	th {
		color: var(--text-secondary);
		font-weight: var(--weight-medium);
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		border-bottom: 1px solid var(--line-strong);
	}
	td {
		height: var(--row-height);
		border-bottom: 1px solid var(--line);
	}
	/* A row that navigates says so (#359). The anchor this file wraps the
	   first cell in inherited the body colour with no underline, so on
	   `/clients`, `/invoices` and `/mail` the only way to discover the
	   primary navigation of a list was to hover it - and hover does not
	   exist on the phone this product is meant to be usable from. Underline
	   rather than a colour, matching `PageHeader.svelte`'s own treatment of
	   the breadcrumb trail and the back link, so this applies a decision
	   the app had already taken instead of adding a second one. Both views
	   below carry the same anchor, so both are covered. */
	td a,
	.title a {
		color: inherit;
		text-decoration: underline;
		text-underline-offset: 0.15em;
	}
	td a:hover,
	.title a:hover {
		text-decoration-thickness: 2px;
	}
	tbody tr:hover {
		background: var(--surface-2);
	}
	.end {
		text-align: end;
	}
	.sort {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		width: 100%;
		font: inherit;
		color: inherit;
		text-transform: inherit;
		letter-spacing: inherit;
		background: none;
		border: 0;
		padding: 0;
		cursor: pointer;
	}
	.end .sort {
		justify-content: flex-end;
	}
	.sort-icon {
		font-size: var(--text-2xs);
		color: var(--text-muted);
	}
	.cards {
		display: none;
		flex-direction: column;
		gap: var(--space-2);
		list-style: none;
		padding: 0;
	}
	.cards.compact {
		gap: var(--space-1);
	}
	.title {
		font-weight: var(--weight-bold);
		margin: 0 0 var(--space-2);
	}
	dl {
		margin: 0;
		font-size: var(--text-sm);
	}
	.pair {
		display: flex;
		justify-content: space-between;
		gap: var(--space-4);
		padding: var(--space-1) 0;
	}
	dt {
		color: var(--text-secondary);
	}
	dd {
		margin: 0;
		overflow-wrap: anywhere;
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
