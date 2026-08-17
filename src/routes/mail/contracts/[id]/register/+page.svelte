<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import Page from '$lib/layout/Page.svelte';
	import { EmptyState } from '$lib/design';
	import Table from '$lib/design/Table.svelte';
	import type { TableColumn } from '$lib/design/table';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// `resolve()`'s route id accepts a literal `?search` suffix
	// (`RouteIdWithSearchOrHash`), so the query string stays inside the
	// call the lint rule requires rather than a separately built string.
	const pdfHref = $derived(
		resolve(`/mail/contracts/[id]/register/pdf?from=${data.from}&to=${data.to}`, {
			id: data.contract.id
		})
	);
	const csvHref = $derived(
		resolve(`/mail/contracts/[id]/register/csv?from=${data.from}&to=${data.to}`, {
			id: data.contract.id
		})
	);

	type Row = PageData['register']['entries'][number];

	const columns: readonly TableColumn<Row>[] = [
		{ key: 'date', label: m.register_column_date() },
		{ key: 'quantity', label: m.register_column_quantity(), align: 'end' },
		{ key: 'scope', label: m.register_column_scope() },
		{
			key: 'approval',
			label: m.register_column_approval(),
			format: (row) => `${row.approval.channel} · ${row.approval.sender}`
		}
	];
</script>

<svelte:head
	><title>{m.register_page_title({ contractTitle: data.contract.title })}</title></svelte:head
>

{#snippet empty()}
	<EmptyState icon="🗓" title={m.register_empty_title()} body={m.register_empty()} />
{/snippet}

<Page crumbs={data.crumbs} title={m.register_heading({ contractTitle: data.contract.title })}>
	<form method="GET" class="mt-4 flex flex-wrap items-end gap-3 text-sm">
		<label class="flex flex-col gap-1">
			{m.register_period_from_label()}
			<input type="date" name="from" value={data.from} class="border px-2 py-1" />
		</label>
		<label class="flex flex-col gap-1">
			{m.register_period_to_label()}
			<input type="date" name="to" value={data.to} class="border px-2 py-1" />
		</label>
		<button type="submit" class="border px-4 py-2">{m.register_period_submit()}</button>
	</form>

	<div class="mt-4 flex gap-4 text-sm">
		<a class="underline" href={pdfHref}>{m.register_download_pdf_link()}</a>
		<a class="underline" href={csvHref}>{m.register_download_csv_link()}</a>
	</div>

	<div class="mt-4">
		<Table
			{columns}
			rows={data.register.entries}
			caption={m.register_heading({ contractTitle: data.contract.title })}
			rowKey={(row) => row.workUnitId}
			{empty}
		/>
		{#if data.register.entries.length > 0}
			<p class="totals">
				<strong>{m.register_totals_label()}:</strong>
				{data.register.totalQuantity}
			</p>
		{/if}
	</div>
</Page>

<style>
	.totals {
		margin-top: var(--space-2);
		font-size: var(--text-sm);
		text-align: end;
	}
</style>
