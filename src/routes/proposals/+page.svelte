<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import { formatDateTime, formatPercent } from '$lib/i18n/format';
	import PageHeader from '$lib/nav/PageHeader.svelte';
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

<main class="mx-auto max-w-4xl p-4 sm:p-8">
	<PageHeader title={m.proposal_list_heading()} />

	<nav class="mt-4 flex flex-wrap gap-1 border-b text-sm" aria-label={m.proposal_list_heading()}>
		{#each tabs as tab (tab)}
			<a
				href="{resolve('/proposals')}?status={tab}"
				class="tab border-b-2 px-3"
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
		<!-- #64: a five-column table is exactly the shape that forces
		     horizontal scrolling once the excerpt column has real text in
		     it — the review queue is one of the three phone-critical flows,
		     so this is a card per proposal instead, one full-width tap
		     target per row with nothing that cannot wrap. -->
		<ul class="mt-4 flex flex-col gap-3">
			{#each data.rows as row (row.id)}
				<li>
					<a href={resolve('/proposals/[id]', { id: row.id })} class="proposal-card">
						<div class="proposal-card-head">
							<span class="proposal-card-contract">
								<span class="sr-only"
									>{m.proposal_list_column_contract()}:
								</span>{row.contractTitle}
							</span>
							<span class="proposal-card-confidence">
								<span class="sr-only">{m.proposal_list_column_confidence()}: </span>{formatPercent(
									row.confidence
								)}
							</span>
						</div>
						<p class="proposal-card-meta">
							<span class="sr-only"
								>{m.proposal_list_column_target()}:
							</span>{proposalTargetTypeLabel(row.targetType)}
							<span aria-hidden="true"> · </span>
							<span class="sr-only">{m.proposal_list_column_created()}: </span>{formatDateTime(
								row.createdAt
							)}
						</p>
						<p class="proposal-card-excerpt">
							<span class="sr-only">{m.proposal_list_column_excerpt()}: </span>{row.excerpt}
						</p>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</main>

<style>
	.tab {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
	}
	.proposal-card {
		display: block;
		border: 1px solid var(--border-hairline);
		border-radius: 8px;
		padding: 0.875rem 1rem;
		color: inherit;
		text-decoration: none;
	}
	.proposal-card:hover,
	.proposal-card:focus-visible {
		background: var(--surface-1);
		outline: 2px solid var(--certainty-projected);
		outline-offset: -2px;
	}
	.proposal-card-head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.proposal-card-contract {
		color: var(--text-primary);
		font-weight: 600;
		font-size: 0.9375rem;
		overflow-wrap: anywhere;
	}
	.proposal-card-confidence {
		flex: none;
		color: var(--text-secondary);
		font-size: 0.8125rem;
		font-variant-numeric: tabular-nums;
	}
	.proposal-card-meta {
		margin: 0.25rem 0 0;
		color: var(--text-secondary);
		font-size: 0.8125rem;
	}
	.proposal-card-excerpt {
		margin: 0.5rem 0 0;
		color: var(--text-secondary);
		font-size: 0.8125rem;
		font-style: italic;
		opacity: 0.85;
		overflow-wrap: anywhere;
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
</style>
