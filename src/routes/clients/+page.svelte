<!--
	The client list (#242): "who owes me and how exposed am I to them",
	answerable from this page alone. Migrated from `RecordList` to `Table`
	— the sortable, rich-cell successor — because this is the first list
	that actually needs both: a sortable money column and a badge cell.
	Identity columns (tax id, country, notice channel, contacts) moved off
	this list entirely: they answer "who is this", not "who owes me", and
	live on the detail page instead, which still leads with these same
	figures before them.
-->
<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import { formatDays, formatPercent } from '$lib/i18n/format';
	import Page from '$lib/layout/Page.svelte';
	import Amount from '$lib/design/Amount.svelte';
	import Badge from '$lib/design/Badge.svelte';
	import EmptyState from '$lib/design/EmptyState.svelte';
	import Table from '$lib/design/Table.svelte';
	import type { TableColumn } from '$lib/design/table';
	import { concentrationBadge } from './concentration-badge';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type Row = PageData['clients'][number];

	// The fiscal engine carries no currency of its own (`fiscal/ledger.ts`'s
	// `LedgerRow`); every contract in this codebase is EUR, the same
	// assumption `CeilingMeter` and the dashboard already make.
	const CURRENCY = 'EUR';

	// The list's own acceptance bullet, read literally as the default
	// order: the client owing the most sits first. A header click
	// (`Table`'s own sort state) overrides this, never the reverse.
	const rows = $derived(
		[...data.clients].sort((a, b) => b.exposure.outstanding - a.exposure.outstanding)
	);

	const columns: readonly TableColumn<Row>[] = $derived([
		{
			key: 'legalName',
			label: m.clients_column_legal_name(),
			sort: (a: Row, b: Row) => a.legalName.localeCompare(b.legalName)
		},
		{
			key: 'outstanding',
			label: m.clients_column_outstanding(),
			align: 'end',
			sort: (a: Row, b: Row) => a.exposure.outstanding - b.exposure.outstanding,
			cell: outstandingCell
		},
		{
			key: 'collected',
			label: m.clients_column_collected(),
			align: 'end',
			sort: (a: Row, b: Row) => a.exposure.collectedThisYear - b.exposure.collectedThisYear,
			cell: collectedCell
		},
		{
			key: 'days',
			label: m.clients_column_days(),
			align: 'end',
			sort: (a: Row, b: Row) => a.exposure.daysThisYear - b.exposure.daysThisYear,
			format: (row: Row) => (row.hasContract ? formatDays(row.exposure.daysThisYear) : '—')
		},
		{
			key: 'share',
			label: m.clients_column_share(),
			align: 'end',
			sort: (a: Row, b: Row) => a.exposure.revenueShareThisYear - b.exposure.revenueShareThisYear,
			cell: shareCell
		}
	]);
</script>

{#snippet outstandingCell(row: Row)}
	{#if row.hasContract}
		<Amount minorUnits={row.exposure.outstanding} currency={CURRENCY} size="md" />
	{:else}
		<span class="no-contract">
			<span aria-hidden="true">—</span>
			<span class="sr-only">{m.clients_no_contract()}</span>
		</span>
	{/if}
{/snippet}

{#snippet collectedCell(row: Row)}
	{#if row.hasContract}
		<Amount minorUnits={row.exposure.collectedThisYear} currency={CURRENCY} size="md" />
	{:else}
		<span class="no-contract">
			<span aria-hidden="true">—</span>
			<span class="sr-only">{m.clients_no_contract()}</span>
		</span>
	{/if}
{/snippet}

{#snippet shareCell(row: Row)}
	{#if row.hasContract}
		{@const badge = concentrationBadge(row.exposure.concentrationCap)}
		<span class="share-cell">
			<span class="tabular">{formatPercent(row.exposure.revenueShareThisYear)}</span>
			{#if badge}
				<Badge variant={badge.variant} label={badge.label} size="sm" />
			{/if}
		</span>
	{:else}
		<Badge variant="neutral" label={m.clients_no_contract()} size="sm" />
	{/if}
{/snippet}

{#snippet empty()}
	<EmptyState icon="€" title={m.clients_empty_title()} body={m.clients_empty_body()}>
		{#snippet actions()}
			<a href={resolve('/clients/new')} class="underline">{m.clients_new_link()}</a>
		{/snippet}
	</EmptyState>
{/snippet}

<svelte:head><title>{m.clients_page_title()}</title></svelte:head>

<Page title={m.clients_heading()} width="wide">
	{#snippet actions()}
		<a href={resolve('/clients/new')} class="underline">{m.clients_new_link()}</a>
	{/snippet}

	<p class="basis-note">{m.clients_exposure_basis_note()}</p>

	<Table
		{columns}
		{rows}
		caption={m.clients_heading()}
		rowKey={(client) => client.id}
		rowHref={(client) => `/clients/${client.id}`}
		{empty}
	/>
</Page>

<style>
	.basis-note {
		margin: 0 0 var(--space-4);
		font-size: var(--text-sm);
		color: var(--text-secondary);
		max-width: 60ch;
	}
	.no-contract {
		display: block;
		text-align: right;
		color: var(--text-muted);
	}
	.share-cell {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: flex-end;
		gap: var(--space-1) var(--space-2);
	}
	.share-cell .tabular {
		flex-shrink: 0;
		white-space: nowrap;
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
