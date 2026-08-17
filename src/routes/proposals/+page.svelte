<!--
	The review queue (#243): pending proposals grouped by the archived
	message that produced them — two days from one "ok for Thursday and
	Friday" email read as siblings, each with its own accept/reject, plus
	one accept-all for the message. Decided history (`?status=accepted` /
	`?status=rejected`) is a flatter list, one row each, nothing left to
	group by message once the decision is made.
-->
<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import { formatDate, formatDateTime } from '$lib/i18n/format';
	import { factLine } from '$lib/nav/crumbs';
	import { Amount, Badge, Button, EmptyState, Tabs } from '$lib/design';
	import Page from '$lib/layout/Page.svelte';
	import Section from '$lib/layout/Section.svelte';
	import ProposalStatusBadge from './ProposalStatusBadge.svelte';
	import { proposalConfidenceBadge, proposalQuantityLabel } from './proposal-status';
	import { proposalIssueMessage } from '$lib/i18n/proposal-issue';
	import { submitting } from '$lib/design/submitting.svelte';
	import type { ActionData, PageProps } from './$types';

	let { data, form }: PageProps & { form: ActionData } = $props();

	const tabs = $derived([
		{
			href: `${resolve('/proposals')}?status=pending`,
			label: m.proposal_list_tab_pending(),
			selected: data.status === 'pending',
			badge:
				data.pendingCount !== null
					? { variant: 'info' as const, count: data.pendingCount }
					: undefined
		},
		{
			href: `${resolve('/proposals')}?status=accepted`,
			label: m.proposal_list_tab_accepted(),
			selected: data.status === 'accepted'
		},
		{
			href: `${resolve('/proposals')}?status=rejected`,
			label: m.proposal_list_tab_rejected(),
			selected: data.status === 'rejected'
		}
	]);

	function rowTitle(date: string | null, quantity: number | null): string {
		const datePart = date ? formatDate(date) : '—';
		const quantityPart = quantity !== null ? proposalQuantityLabel(quantity) : '—';
		return `${datePart} — ${quantityPart}`;
	}
</script>

<svelte:head><title>{m.proposal_list_page_title()}</title></svelte:head>

<Page title={m.proposal_list_heading()} subtitle={m.proposal_list_subtitle()} width="wide">
	<Tabs label={m.proposal_list_heading()} {tabs} />

	{#if form?.actionError}
		<p class="action-error" role="alert">
			{form.actionError}
		</p>
	{/if}

	{#if data.status === 'pending'}
		{#if data.groups.length === 0}
			<EmptyState
				icon="✓"
				title={m.proposal_list_empty_pending_title()}
				body={m.proposal_list_empty_pending_body()}
			/>
		{:else}
			{#each data.groups as group (group.documentId)}
				{@const blocked = group.rows.some((row) => row.validationIssue !== null)}
				{@const acceptAll = submitting()}
				<Section title={group.subject ?? m.proposal_queue_no_subject()}>
					{#snippet actions()}
						<a href={resolve('/proposals/[id]', { id: group.rows[0].id })} class="open-message">
							{m.proposal_queue_open_message()}
						</a>
					{/snippet}

					<ul class="rows">
						{#each group.rows as row (row.id)}
							{@const confidence = proposalConfidenceBadge(row.confidence)}
							{@const accept = submitting()}
							{@const reject = submitting()}
							<li class="row">
								<span class="row-ico" aria-hidden="true">◇</span>
								<div class="row-main">
									<span class="row-title">{rowTitle(row.date, row.quantity)}</span>
									<span class="row-meta">
										<Badge variant={confidence.variant} label={confidence.label} size="sm" />
										{#if row.amount !== null}
											<Amount major={row.amount} currency={group.currency} size="inline" />
										{/if}
										{#if row.validationIssue}
											<span class="row-flag">{proposalIssueMessage(row.validationIssue)}</span>
										{/if}
									</span>
								</div>
								<div class="row-actions">
									<Button
										href={resolve('/proposals/[id]', { id: row.id })}
										variant="tertiary"
										size="sm"
									>
										{m.proposal_queue_review()}
									</Button>
									<form method="POST" action="?/accept" onsubmit={accept.onsubmit}>
										<input type="hidden" name="id" value={row.id} />
										<Button
											type="submit"
											variant="primary"
											size="sm"
											disabled={row.validationIssue !== null}
											loading={accept.busy}
										>
											{m.proposal_detail_accept_submit()}
										</Button>
									</form>
									<form method="POST" action="?/reject" onsubmit={reject.onsubmit}>
										<input type="hidden" name="id" value={row.id} />
										<Button type="submit" variant="danger" size="sm" loading={reject.busy}>
											{m.proposal_detail_reject_submit()}
										</Button>
									</form>
								</div>
							</li>
						{/each}
					</ul>

					<div class="group-footer">
						<span class="fact-line">
							{factLine([group.sender, group.contractTitle, group.clientLegalName])}
						</span>
						{#if group.rows.length > 1}
							<form method="POST" action="?/acceptAll" onsubmit={acceptAll.onsubmit}>
								<input type="hidden" name="documentId" value={group.documentId} />
								<Button
									type="submit"
									variant="secondary"
									size="sm"
									disabled={blocked}
									loading={acceptAll.busy}
								>
									{m.proposal_queue_accept_all({ count: group.rows.length })}
								</Button>
							</form>
						{/if}
					</div>
				</Section>
			{/each}
		{/if}
	{:else if data.rows.length === 0}
		<EmptyState
			icon={data.status === 'accepted' ? '✓' : '○'}
			title={data.status === 'accepted'
				? m.proposal_list_empty_accepted_title()
				: m.proposal_list_empty_rejected_title()}
			body={data.status === 'accepted'
				? m.proposal_list_empty_accepted_body()
				: m.proposal_list_empty_rejected_body()}
		/>
	{:else}
		<ul class="rows history">
			{#each data.rows as row (row.id)}
				<li class="row">
					<span class="row-ico" aria-hidden="true">{row.status === 'accepted' ? '✓' : '✕'}</span>
					<div class="row-main">
						<a class="row-title" href={resolve('/proposals/[id]', { id: row.id })}>
							{rowTitle(row.date, row.quantity)}
						</a>
						<span class="row-meta">
							<ProposalStatusBadge status={row.status} />
							{#if row.status === 'accepted'}
								{row.sender
									? m.proposal_history_created_note({
											sender: row.sender,
											when: row.receivedAt ? formatDateTime(row.receivedAt) : ''
										})
									: m.proposal_history_created_note_no_sender({
											when: row.receivedAt ? formatDateTime(row.receivedAt) : ''
										})}
								{#if row.amount !== null}
									·
									<Amount major={row.amount} currency={row.currency} size="inline" />
								{/if}
							{:else}
								{m.proposal_history_rejected_note({
									when: row.receivedAt ? formatDateTime(row.receivedAt) : ''
								})}
							{/if}
						</span>
					</div>
					<div class="row-actions">
						{#if row.status === 'accepted' && row.resultId}
							<Button
								href={resolve('/day/[id]', { id: row.resultId })}
								variant="tertiary"
								size="sm"
							>
								{m.proposal_history_view_day()}
							</Button>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</Page>

<style>
	.action-error {
		margin: var(--space-4) 0 0;
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--color-danger);
		border-radius: var(--radius-md);
		color: var(--color-danger);
		font-size: var(--text-sm);
	}
	.open-message {
		font-size: var(--text-sm);
		color: var(--color-primary);
	}
	.rows {
		display: flex;
		flex-direction: column;
		margin: 0;
		padding: 0;
		list-style: none;
		border: 1px solid var(--border-hairline);
		border-radius: var(--radius-md);
	}
	.rows.history {
		margin-top: var(--space-4);
	}
	.row {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
	}
	.row + .row {
		border-top: 1px solid var(--border-hairline);
	}
	.row-ico {
		flex: none;
		margin-top: 0.2em;
		color: var(--text-muted);
	}
	.row-main {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
		flex: 1;
	}
	.row-title {
		font-size: var(--text-md);
		font-weight: var(--weight-medium);
		color: var(--text-primary);
		text-decoration: none;
	}
	a.row-title:hover {
		text-decoration: underline;
	}
	.row-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}
	.row-flag {
		color: var(--color-danger);
		font-weight: var(--weight-medium);
	}
	.row-actions {
		flex: none;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.group-footer {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		margin-top: var(--space-3);
	}
	.fact-line {
		font-size: var(--text-sm);
		color: var(--text-muted);
	}
	@media (max-width: 639px) {
		.row {
			flex-wrap: wrap;
		}
		.row-actions {
			width: 100%;
		}
	}
</style>
