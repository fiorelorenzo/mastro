<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>{m.mail_index_page_title()}</title></svelte:head>

<main class="mx-auto max-w-3xl p-8">
	<h1 class="text-2xl font-semibold">{m.mail_index_heading()}</h1>

	{#if data.contracts.length === 0}
		<p class="mt-4 text-sm opacity-70">{m.mail_index_empty()}</p>
	{:else}
		<table class="mt-4 w-full border-collapse text-sm">
			<thead>
				<tr class="border-b text-left">
					<th class="py-2 pr-4">{m.mail_index_column_contract()}</th>
					<th class="py-2 pr-4">{m.mail_index_column_client()}</th>
					<th class="py-2"></th>
				</tr>
			</thead>
			<tbody>
				{#each data.contracts as contract (contract.id)}
					<tr class="border-b">
						<td class="py-2 pr-4">{contract.title}</td>
						<td class="py-2 pr-4">{contract.client.legalName}</td>
						<td class="py-2">
							<a href={resolve('/mail/contracts/[id]', { id: contract.id })} class="underline"
								>{m.mail_index_open_link()}</a
							>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</main>
