<!--
	The ageing list (#238): every invoice in the instance, not just the
	unpaid ones — tabs switch the slice, a stats strip answers "what's
	owed / what's overdue / what came in this year" at a glance, and the
	unpaid view groups into ageing bands with a subtotal each, so overdue
	money is the loudest thing on the screen instead of a plain-text row
	indistinguishable from a not-yet-due one.
-->
<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import { formatDate, formatDays, formatMinorUnits, formatNumber } from '$lib/i18n/format';
	import type { MinorUnits } from '$lib/money';
	import { Amount, Badge, Button, StatTile, Tabs } from '$lib/design';
	import EmptyState from '$lib/design/EmptyState.svelte';
	import Table from '$lib/design/Table.svelte';
	import type { TableColumn } from '$lib/design/table';
	import Page from '$lib/layout/Page.svelte';
	import Section from '$lib/layout/Section.svelte';
	import { invoiceStatus } from './status';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type Row = PageData['rows'][number];

	const tabs = $derived([
		{
			href: `${resolve('/invoices')}?tab=all`,
			label: m.invoices_tab_all(),
			selected: data.tab === 'all'
		},
		{
			href: `${resolve('/invoices')}?tab=due`,
			label: m.invoices_tab_due(),
			selected: data.tab === 'due',
			badge: { variant: 'warning' as const, count: data.unpaidCount }
		},
		{
			href: `${resolve('/invoices')}?tab=overdue`,
			label: m.invoices_tab_overdue(),
			selected: data.tab === 'overdue',
			badge: { variant: 'critical' as const, count: data.overdueCount }
		},
		{
			href: `${resolve('/invoices')}?tab=paid`,
			label: m.invoices_tab_paid(),
			selected: data.tab === 'paid'
		}
	]);

	// A stat's value can span more than one currency (rare, but the old
	// summary already had to handle it) — each figure joined into one
	// string, since `StatTile.value` is a single pre-formatted string.
	// `fallbackCurrency` is only for an empty band's subtotal: "0" reads as
	// a stray digit next to five currency-formatted figures, so a known
	// currency (the tab's own) formats a proper zero instead.
	function totalsLabel(
		byCurrency: Record<string, MinorUnits>,
		fallbackCurrency: string | null = null
	): string {
		const currencies = Object.keys(byCurrency).sort();
		if (currencies.length === 0) {
			return fallbackCurrency
				? formatMinorUnits(0 as MinorUnits, fallbackCurrency)
				: formatNumber(0);
		}
		return currencies
			.map((currency) => formatMinorUnits(byCurrency[currency], currency))
			.join(', ');
	}

	const emptyContent = $derived.by(() => {
		if (data.tab === 'all') {
			return { icon: '€', title: m.invoices_empty_all_title(), body: m.invoices_empty_all_body() };
		}
		if (data.tab === 'overdue') {
			return {
				icon: '✓',
				title: m.invoices_empty_overdue_title(),
				body: m.invoices_empty_overdue_body()
			};
		}
		if (data.tab === 'paid') {
			return {
				icon: '€',
				title: m.invoices_empty_paid_title(),
				body: m.invoices_empty_paid_body()
			};
		}
		return { icon: '✓', title: m.invoices_empty_due_title(), body: m.invoices_empty_due_body() };
	});

	// A currency to format an empty band's "0" subtotal in — any row on the
	// tab will do, since a real multi-currency instance is the rare case
	// `totalsLabel` already handles for a non-empty total.
	const fallbackCurrency = $derived(data.rows[0]?.invoice.currency ?? null);

	// #311: preserves the active tab while walking to another page —
	// the same query-param shape the tab links already use.
	function pageHref(page: number): string {
		return `${resolve('/invoices')}?tab=${data.tab}&page=${page}`;
	}
</script>

<svelte:head><title>{m.invoices_page_title()}</title></svelte:head>

{#snippet numberCell(row: Row)}
	<span class="mono">{row.invoice.number}</span>
{/snippet}
{#snippet statusCell(row: Row)}
	{@const status = invoiceStatus(row.daysLate, row.balance.settledOn)}
	<Badge variant={status.level} label={status.label} />
{/snippet}
{#snippet totalCell(row: Row)}
	<Amount
		minorUnits={row.balance.settled ? row.invoice.total : row.balance.remaining}
		currency={row.invoice.currency}
		size="md"
	/>
	{#if !row.balance.settled && row.balance.paid > 0}
		<span class="hint"
			>{m.invoices_row_partial_payment_hint({
				amount: formatMinorUnits(row.balance.paid, row.invoice.currency)
			})}</span
		>
	{/if}
{/snippet}
{#snippet actionsCell(row: Row)}
	{#if row.overdue}
		<Button
			href={resolve('/invoices/[id=uuid]/remind', { id: row.invoice.id })}
			variant="secondary"
			size="sm"
		>
			{m.invoices_row_chase_action()}
		</Button>
	{/if}
{/snippet}
{#snippet bandEmpty()}
	<p class="band-empty">{m.invoices_band_empty()}</p>
{/snippet}

<Page title={m.invoices_heading()} subtitle={m.invoices_subtitle()} width="wide">
	{#snippet actions()}
		<Button href={resolve('/invoices/new')} variant="secondary" size="sm">
			{m.invoices_new_link()}
		</Button>
	{/snippet}

	<Tabs label={m.invoices_tabs_label()} {tabs} />

	<div class="stats">
		<StatTile
			label={m.invoices_stat_outstanding_label()}
			value={totalsLabel(data.totalOutstandingByCurrency)}
			sub={m.invoices_stat_outstanding_sub({ count: data.unpaidCount })}
		/>
		<StatTile
			label={m.invoices_stat_overdue_label()}
			value={totalsLabel(data.totalOverdueByCurrency)}
			sub={data.overdueCount > 0
				? m.invoices_stat_overdue_sub({
						count: data.overdueCount,
						days: formatDays(data.worstDaysLate)
					})
				: m.invoices_stat_overdue_sub_none()}
		/>
		<StatTile
			label={m.invoices_stat_collected_label()}
			value={totalsLabel(data.totalCollectedThisYearByCurrency)}
			sub={m.invoices_stat_collected_sub({ count: data.paidThisYearCount })}
		/>
	</div>

	{@const columns = [
		{ key: 'number', label: m.invoices_column_number(), cell: numberCell },
		{ key: 'client', label: m.invoices_column_client(), format: (row) => row.clientLegalName },
		{
			key: 'issueDate',
			label: m.invoices_column_issue_date(),
			format: (row) => formatDate(row.invoice.issueDate)
		},
		{
			key: 'dueDate',
			label: m.invoices_column_due_date(),
			format: (row) => formatDate(row.invoice.dueDate)
		},
		{ key: 'status', label: m.invoices_column_status(), cell: statusCell },
		{
			key: 'days',
			label: m.invoices_column_days(),
			align: 'end',
			format: (row) => (row.dayCount > 0 ? formatDays(row.dayCount) : '—')
		},
		{ key: 'total', label: m.invoices_column_total(), align: 'end', cell: totalCell },
		{ key: 'actions', label: m.invoices_column_actions(), cell: actionsCell }
	] satisfies readonly TableColumn<Row>[]}

	{#if data.rows.length === 0}
		<EmptyState icon={emptyContent.icon} title={emptyContent.title} body={emptyContent.body}>
			{#snippet actions()}
				<Button href={resolve('/invoices/new')} variant="primary">{m.invoices_new_link()}</Button>
			{/snippet}
		</EmptyState>
	{:else if data.bands}
		{#each data.bands as band (band.key)}
			<Section title={band.label}>
				{#snippet actions()}
					<span class="band-subtotal">
						{m.invoices_band_subtotal_label()}
						<strong>{totalsLabel(band.subtotalByCurrency, fallbackCurrency)}</strong>
					</span>
				{/snippet}
				<Table
					{columns}
					rows={band.rows}
					caption={band.label}
					rowKey={(row) => row.invoice.id}
					rowHref={(row) => `/invoices/${row.invoice.id}`}
					empty={bandEmpty}
				/>
			</Section>
		{/each}
	{:else}
		<Table
			{columns}
			rows={data.rows}
			caption={m.invoices_heading()}
			rowKey={(row) => row.invoice.id}
			rowHref={(row) => `/invoices/${row.invoice.id}`}
			empty={bandEmpty}
		/>
	{/if}

	{#if data.totalPages > 1}
		<nav class="pagination" aria-label={m.invoices_pagination_label()}>
			<p class="pagination-range">
				{m.invoices_pagination_range({
					start: formatNumber(data.rangeStart),
					end: formatNumber(data.rangeEnd),
					total: formatNumber(data.totalCount)
				})}
			</p>
			<div class="pagination-links">
				{#if data.page > 1}
					<Button href={pageHref(data.page - 1)} variant="secondary" size="sm">
						{m.invoices_pagination_previous()}
					</Button>
				{/if}
				{#if data.page < data.totalPages}
					<Button href={pageHref(data.page + 1)} variant="secondary" size="sm">
						{m.invoices_pagination_next()}
					</Button>
				{/if}
			</div>
		</nav>
	{/if}
</Page>

<style>
	.stats {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--space-4);
		margin: var(--space-4) 0 var(--space-6);
		padding: var(--space-4);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
	}
	@media (max-width: 479px) {
		.stats {
			grid-template-columns: 1fr;
		}
	}
	.mono {
		font-family: var(--font-mono);
	}
	.band-subtotal {
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}
	.band-subtotal strong {
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		color: var(--text-primary);
	}
	.band-empty {
		margin: 0;
		padding: var(--space-3) 0;
		font-size: var(--text-sm);
		font-style: italic;
		color: var(--text-muted);
	}
	.hint {
		display: block;
		text-align: right;
		font-size: var(--text-xs);
		color: var(--text-muted);
	}
	.pagination {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		margin-top: var(--space-4);
	}
	.pagination-range {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}
	.pagination-links {
		display: flex;
		gap: var(--space-2);
	}
</style>
