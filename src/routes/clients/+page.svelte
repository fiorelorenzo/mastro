<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import { formatNumber } from '$lib/i18n/format';
	import { noticeChannelLabel } from './notice-channel';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>{m.clients_page_title()}</title></svelte:head>

<main class="mx-auto max-w-3xl p-8">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-semibold">{m.clients_heading()}</h1>
		<a href={resolve('/clients/new')} class="text-sm underline">{m.clients_new_link()}</a>
	</div>

	{#if data.clients.length === 0}
		<p class="mt-4 text-sm opacity-70">{m.clients_empty()}</p>
	{:else}
		<table class="mt-4 w-full border-collapse text-sm">
			<thead>
				<tr class="border-b text-left">
					<th class="py-2 pr-4">{m.clients_column_legal_name()}</th>
					<th class="py-2 pr-4">{m.clients_column_tax_id()}</th>
					<th class="py-2 pr-4">{m.clients_column_country()}</th>
					<th class="py-2 pr-4">{m.clients_column_notice_channel()}</th>
					<th class="py-2 pr-4">{m.clients_column_contacts()}</th>
					<th class="py-2"></th>
				</tr>
			</thead>
			<tbody>
				{#each data.clients as client (client.id)}
					<tr class="border-b">
						<td class="py-2 pr-4">
							<a href={resolve('/clients/[id]', { id: client.id })} class="underline"
								>{client.legalName}</a
							>
						</td>
						<td class="py-2 pr-4">{client.taxId}</td>
						<td class="py-2 pr-4">{client.country}</td>
						<td class="py-2 pr-4">{noticeChannelLabel(client.noticeChannel)}</td>
						<td class="py-2 pr-4">
							{formatNumber(client.contacts.length)}
							{#if client.contacts.some((contact) => contact.canApprove)}
								<span class="opacity-70">{m.clients_can_approve_suffix()}</span>
							{/if}
						</td>
						<td class="py-2">
							<a href={resolve('/clients/[id]/edit', { id: client.id })} class="underline"
								>{m.clients_edit_link()}</a
							>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</main>
