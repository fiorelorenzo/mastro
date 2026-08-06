<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Clients — mastro</title></svelte:head>

<main class="mx-auto max-w-3xl p-8">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-semibold">Clients</h1>
		<a href={resolve('/clients/new')} class="text-sm underline">New client</a>
	</div>

	{#if data.clients.length === 0}
		<p class="mt-4 text-sm opacity-70">No clients yet.</p>
	{:else}
		<table class="mt-4 w-full border-collapse text-sm">
			<thead>
				<tr class="border-b text-left">
					<th class="py-2 pr-4">Legal name</th>
					<th class="py-2 pr-4">Tax id</th>
					<th class="py-2 pr-4">Country</th>
					<th class="py-2 pr-4">Notice channel</th>
					<th class="py-2 pr-4">Contacts</th>
					<th class="py-2"></th>
				</tr>
			</thead>
			<tbody>
				{#each data.clients as client (client.id)}
					<tr class="border-b">
						<td class="py-2 pr-4">{client.legalName}</td>
						<td class="py-2 pr-4">{client.taxId}</td>
						<td class="py-2 pr-4">{client.country}</td>
						<td class="py-2 pr-4">{client.noticeChannel}</td>
						<td class="py-2 pr-4">
							{client.contacts.length}
							{#if client.contacts.some((contact) => contact.canApprove)}
								<span class="opacity-70">(can approve)</span>
							{/if}
						</td>
						<td class="py-2">
							<a href={resolve('/clients/[id]/edit', { id: client.id })} class="underline">Edit</a>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</main>
