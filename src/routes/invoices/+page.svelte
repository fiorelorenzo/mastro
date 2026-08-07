<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import { formatDate, formatDays, formatMinorUnits, formatNumber } from '$lib/i18n/format';
	import Page from '$lib/layout/Page.svelte';
	import RecordList from '$lib/layout/RecordList.svelte';
	import type { RecordColumn } from '$lib/layout/types';
	import { ageingStatus } from './status';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const outstandingCurrencies = $derived(Object.keys(data.totalOutstandingByCurrency).sort());

	type Row = PageData['rows'][number];

	// The status chip lost its icon here: `RecordList` renders a column
	// through a plain string in both the table and the card view, and the
	// ageing label already states the figure in words, so nothing that
	// invariant 5's neighbour rule (color never alone) depended on is lost.
	const columns: readonly RecordColumn<Row>[] = $derived([
		{ key: 'number', label: m.invoices_column_number(), format: (row: Row) => row.invoice.number },
		{ key: 'client', label: m.invoices_column_client(), format: (row: Row) => row.clientLegalName },
		{
			key: 'dueDate',
			label: m.invoices_column_due_date(),
			format: (row: Row) => formatDate(row.invoice.dueDate)
		},
		{
			key: 'status',
			label: m.invoices_column_status(),
			format: (row: Row) => ageingStatus(row.daysLate).label
		},
		{
			key: 'days',
			label: m.invoices_column_days(),
			format: (row: Row) => formatDays(row.dayCount)
		},
		{
			key: 'total',
			label: m.invoices_column_total(),
			align: 'end',
			format: (row: Row) => formatMinorUnits(row.invoice.total, row.invoice.currency)
		}
	]);
</script>

<svelte:head><title>{m.invoices_page_title()}</title></svelte:head>

<Page title={m.invoices_heading()} width="wide">
	{#snippet actions()}
		<a href={resolve('/invoices/new')} class="underline">{m.invoices_new_link()}</a>
	{/snippet}

	<dl class="flex flex-wrap gap-8 text-sm">
		<div>
			<dt class="opacity-70">{m.invoices_summary_total_outstanding()}</dt>
			{#if outstandingCurrencies.length === 0}
				<dd class="font-semibold">{formatNumber(0)}</dd>
			{:else}
				{#each outstandingCurrencies as currency (currency)}
					<dd class="font-semibold">
						{formatMinorUnits(data.totalOutstandingByCurrency[currency], currency)}
					</dd>
				{/each}
			{/if}
		</div>
		<div>
			<dt class="opacity-70">{m.invoices_summary_awaiting_payment_date()}</dt>
			<dd class="font-semibold">{formatNumber(data.awaitingPaymentCount)}</dd>
		</div>
	</dl>

	{#if data.rows.length === 0}
		<p class="mt-4 text-sm opacity-70">{m.invoices_empty()}</p>
	{:else}
		<div class="mt-4">
			<RecordList
				{columns}
				rows={data.rows}
				caption={m.invoices_heading()}
				rowKey={(row) => row.invoice.id}
				rowHref={(row) => `/invoices/${row.invoice.id}`}
			/>
		</div>
	{/if}
</Page>
