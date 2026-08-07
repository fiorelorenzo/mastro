<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import { formatDate } from '$lib/i18n/format';
	import { factLine } from '$lib/nav/crumbs';
	import PageHeader from '$lib/nav/PageHeader.svelte';
	import { noticeChannelLabel } from '../notice-channel';
	import { renewalTypeLabel, statusLabel } from './contracts/contract-enums';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head
	><title>{m.client_detail_page_title({ name: data.client.legalName })}</title></svelte:head
>

<main class="mx-auto max-w-3xl p-8">
	<PageHeader
		crumbs={data.crumbs}
		title={data.client.legalName}
		subtitle={factLine([data.client.taxId, noticeChannelLabel(data.client.noticeChannel)])}
	>
		{#snippet actions()}
			<a href={resolve('/clients/[id]/edit', { id: data.client.id })} class="text-sm underline"
				>{m.clients_edit_link()}</a
			>
		{/snippet}
	</PageHeader>

	<section class="mt-6">
		<dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
			<dt class="opacity-70">{m.client_form_tax_id_label()}</dt>
			<dd>{data.client.taxId}</dd>
			{#if data.client.vatId}
				<dt class="opacity-70">{m.client_form_vat_id_label()}</dt>
				<dd>{data.client.vatId}</dd>
			{/if}
			<dt class="opacity-70">{m.client_form_country_label()}</dt>
			<dd>{data.client.country}</dd>
			<dt class="opacity-70">{m.clients_column_notice_channel()}</dt>
			<dd>{noticeChannelLabel(data.client.noticeChannel)}</dd>
			<dt class="opacity-70">{m.client_form_address_legend()}</dt>
			<dd>
				{data.client.addressLine1}{#if data.client.addressLine2}, {data.client.addressLine2}{/if},
				{data.client.addressCity}
				{data.client.addressPostalCode}
			</dd>
		</dl>

		{#if data.client.contacts.length > 0}
			<h2 class="mt-4 text-sm font-semibold">{m.client_form_contacts_legend()}</h2>
			<ul class="mt-2 flex flex-col gap-1 text-sm">
				{#each data.client.contacts as contact (contact.id)}
					<li>
						{contact.name} — {contact.email}
						{#if contact.canApprove}<span class="opacity-70"
								>({m.clients_can_approve_suffix()})</span
							>{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section class="mt-6">
		<div class="flex items-center justify-between">
			<h2 class="text-lg font-semibold">{m.contract_section_heading()}</h2>
			<a
				href={resolve('/clients/[id]/contracts/new', { id: data.client.id })}
				class="text-sm underline">{m.contract_new_link()}</a
			>
		</div>
		{#if data.contracts.length === 0}
			<p class="mt-2 text-sm opacity-70">{m.contract_empty()}</p>
		{:else}
			<table class="mt-2 w-full border-collapse text-sm">
				<thead>
					<tr class="border-b text-left">
						<th class="py-2 pr-4">{m.contract_form_title_label()}</th>
						<th class="py-2 pr-4">{m.contract_form_status_label()}</th>
						<th class="py-2 pr-4">{m.contract_form_starts_on_label()}</th>
						<th class="py-2 pr-4">{m.contract_form_renewal_type_label()}</th>
						<th class="py-2"></th>
					</tr>
				</thead>
				<tbody>
					{#each data.contracts as contract (contract.id)}
						<tr class="border-b">
							<td class="py-2 pr-4">{contract.title}</td>
							<td class="py-2 pr-4">{statusLabel(contract.status)}</td>
							<td class="py-2 pr-4">{formatDate(contract.startsOn)}</td>
							<td class="py-2 pr-4">{renewalTypeLabel(contract.renewalType)}</td>
							<td class="py-2">
								<a
									href={resolve('/clients/[id]/contracts/[contractId]', {
										id: data.client.id,
										contractId: contract.id
									})}
									class="underline">{m.contract_view_link()}</a
								>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</section>
</main>
