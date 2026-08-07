<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import { formatDateTime, formatPercent } from '$lib/i18n/format';
	import { proposalTargetTypeLabel, type ProposalStatusValue } from './proposal-status';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const tabs: readonly ProposalStatusValue[] = ['pending', 'accepted', 'rejected'];

	function tabLabel(status: ProposalStatusValue): string {
		switch (status) {
			case 'pending':
				return m.proposal_list_tab_pending();
			case 'accepted':
				return m.proposal_list_tab_accepted();
			case 'rejected':
				return m.proposal_list_tab_rejected();
		}
	}

	function emptyLabel(status: ProposalStatusValue): string {
		switch (status) {
			case 'pending':
				return m.proposal_list_empty_pending();
			case 'accepted':
				return m.proposal_list_empty_accepted();
			case 'rejected':
				return m.proposal_list_empty_rejected();
		}
	}
</script>

<svelte:head><title>{m.proposal_list_page_title()}</title></svelte:head>

<main class="mx-auto max-w-4xl p-8">
	<h1 class="text-2xl font-semibold">{m.proposal_list_heading()}</h1>

	<nav class="mt-4 flex gap-4 border-b text-sm">
		{#each tabs as tab (tab)}
			<a
				href="{resolve('/proposals')}?status={tab}"
				class="border-b-2 px-1 pb-2"
				class:border-transparent={data.status !== tab}
				aria-current={data.status === tab ? 'page' : undefined}
			>
				{tabLabel(tab)}
			</a>
		{/each}
	</nav>

	{#if data.rows.length === 0}
		<p class="mt-4 text-sm opacity-70">{emptyLabel(data.status)}</p>
	{:else}
		<table class="mt-4 w-full border-collapse text-sm">
			<thead>
				<tr class="border-b text-left">
					<th class="py-2 pr-4">{m.proposal_list_column_contract()}</th>
					<th class="py-2 pr-4">{m.proposal_list_column_target()}</th>
					<th class="py-2 pr-4">{m.proposal_list_column_confidence()}</th>
					<th class="py-2 pr-4">{m.proposal_list_column_excerpt()}</th>
					<th class="py-2 pr-4">{m.proposal_list_column_created()}</th>
				</tr>
			</thead>
			<tbody>
				{#each data.rows as row (row.id)}
					<tr class="border-b align-top">
						<td class="py-2 pr-4">
							<a href={resolve('/proposals/[id]', { id: row.id })} class="underline"
								>{row.contractTitle}</a
							>
						</td>
						<td class="py-2 pr-4">{proposalTargetTypeLabel(row.targetType)}</td>
						<td class="py-2 pr-4">{formatPercent(row.confidence)}</td>
						<td class="max-w-xs py-2 pr-4 opacity-80">{row.excerpt}</td>
						<td class="py-2 pr-4 whitespace-nowrap">{formatDateTime(row.createdAt)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</main>
