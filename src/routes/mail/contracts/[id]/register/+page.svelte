<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import Page from '$lib/layout/Page.svelte';
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
</script>

<svelte:head
	><title>{m.register_page_title({ contractTitle: data.contract.title })}</title></svelte:head
>

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

	{#if data.register.entries.length === 0}
		<p class="mt-4 text-sm opacity-70">{m.register_empty()}</p>
	{:else}
		<table class="mt-4 w-full border-collapse text-sm">
			<thead>
				<tr class="border-b text-left">
					<th class="py-2 pr-4">{m.register_column_date()}</th>
					<th class="py-2 pr-4">{m.register_column_quantity()}</th>
					<th class="py-2 pr-4">{m.register_column_scope()}</th>
					<th class="py-2">{m.register_column_approval()}</th>
				</tr>
			</thead>
			<tbody>
				{#each data.register.entries as entry (entry.workUnitId)}
					<tr class="border-b">
						<td class="py-2 pr-4">{entry.date}</td>
						<td class="py-2 pr-4">{entry.quantity}</td>
						<td class="py-2 pr-4">{entry.scope}</td>
						<td class="py-2">{entry.approval.channel} · {entry.approval.sender}</td>
					</tr>
				{/each}
				<tr class="font-semibold">
					<td class="py-2 pr-4"></td>
					<td class="py-2 pr-4">{data.register.totalQuantity}</td>
					<td class="py-2 pr-4">{m.register_totals_label()}</td>
					<td class="py-2"></td>
				</tr>
			</tbody>
		</table>
	{/if}
</Page>
