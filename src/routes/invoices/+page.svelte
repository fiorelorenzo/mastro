<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import { formatDate, formatDays, formatMinorUnits, formatNumber } from '$lib/i18n/format';
	import { StatusIndicator } from '$lib/design';
	import PageHeader from '$lib/nav/PageHeader.svelte';
	import { ageingStatus } from './status';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const outstandingCurrencies = $derived(Object.keys(data.totalOutstandingByCurrency).sort());
</script>

<svelte:head><title>{m.invoices_page_title()}</title></svelte:head>

<main class="mx-auto max-w-5xl p-8">
	<PageHeader title={m.invoices_heading()}>
		{#snippet actions()}
			<a href={resolve('/invoices/new')} class="text-sm underline">{m.invoices_new_link()}</a>
		{/snippet}
	</PageHeader>

	<dl class="mt-4 flex gap-8 text-sm">
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
		<table class="mt-4 w-full border-collapse text-sm">
			<thead>
				<tr class="border-b text-left">
					<th class="py-2 pr-4">{m.invoices_column_number()}</th>
					<th class="py-2 pr-4">{m.invoices_column_client()}</th>
					<th class="py-2 pr-4">{m.invoices_column_due_date()}</th>
					<th class="py-2 pr-4">{m.invoices_column_status()}</th>
					<th class="py-2 pr-4">{m.invoices_column_days()}</th>
					<th class="py-2 pr-4 text-end">{m.invoices_column_total()}</th>
				</tr>
			</thead>
			<tbody>
				{#each data.rows as row (row.invoice.id)}
					{@const status = ageingStatus(row.daysLate)}
					<tr class="border-b">
						<td class="py-2 pr-4">
							<a href={resolve('/invoices/[id]', { id: row.invoice.id })} class="underline"
								>{row.invoice.number}</a
							>
						</td>
						<td class="py-2 pr-4">{row.clientLegalName}</td>
						<td class="py-2 pr-4">{formatDate(row.invoice.dueDate)}</td>
						<td class="py-2 pr-4"><StatusIndicator level={status.level} label={status.label} /></td>
						<td class="py-2 pr-4">
							<a href="{resolve('/invoices/[id]', { id: row.invoice.id })}#days" class="underline"
								>{formatDays(row.dayCount)}</a
							>
						</td>
						<td class="py-2 pr-4 text-end"
							>{formatMinorUnits(row.invoice.total, row.invoice.currency)}</td
						>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</main>
