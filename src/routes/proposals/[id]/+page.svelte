<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import { formatDateTime, formatPercent } from '$lib/i18n/format';
	import Page from '$lib/layout/Page.svelte';
	import ProposalStatusBadge from '../ProposalStatusBadge.svelte';
	import { proposalFieldLabel, proposalTargetTypeLabel } from '../proposal-status';
	import type { ActionData, PageProps } from './$types';

	let { data, form }: PageProps & { form: ActionData } = $props();

	const fieldEntries = $derived(Object.entries(data.proposal.proposedFields));

	function inputType(value: unknown): 'number' | 'date' | 'text' {
		if (typeof value === 'number') return 'number';
		if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return 'date';
		return 'text';
	}
</script>

<svelte:head><title>{m.proposal_detail_page_title()}</title></svelte:head>

<Page crumbs={data.crumbs} title={m.proposal_detail_heading()}>
	<div class="mt-2 flex items-center gap-3">
		<ProposalStatusBadge status={data.proposal.status} />
		<span class="text-sm opacity-70">{proposalTargetTypeLabel(data.proposal.targetType)}</span>
	</div>

	<dl
		class="mt-4 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm [&_dd]:min-w-0 [&_dd]:break-words"
	>
		<dt class="opacity-70">{m.proposal_detail_contract_label()}</dt>
		<dd>{data.contract?.title ?? data.proposal.id}</dd>
		<dt class="opacity-70">{m.proposal_detail_confidence_label()}</dt>
		<dd>{formatPercent(data.proposal.confidence)}</dd>
	</dl>

	<div class="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
		<section class="border p-4">
			<h2 class="text-base font-medium">{m.proposal_detail_excerpt_heading()}</h2>
			<blockquote class="mt-2 border-l-2 pl-3 text-sm italic opacity-90">
				{data.proposal.excerpt}
			</blockquote>
		</section>

		<section class="border p-4">
			<h2 class="text-base font-medium">{m.proposal_detail_fields_heading()}</h2>

			{#if data.proposal.status === 'pending'}
				<form method="POST" action="?/accept" class="mt-3 flex flex-col gap-3">
					{#each fieldEntries as [field, value] (field)}
						<label class="flex flex-col gap-1 text-sm">
							<span>{proposalFieldLabel(field)}</span>
							{#if inputType(value) === 'number'}
								<input
									name={field}
									type="number"
									step="any"
									value={value as number}
									class="border px-3 py-3"
								/>
							{:else if inputType(value) === 'date'}
								<input name={field} type="date" value={value as string} class="border px-3 py-3" />
							{:else}
								<input name={field} type="text" value={value as string} class="border px-3 py-3" />
							{/if}
						</label>
					{/each}

					{#if form?.decisionError}
						<p class="text-sm text-red-700">
							{m.proposal_detail_decision_error_heading()}
							{form.decisionError}
						</p>
					{/if}

					<div class="mt-2 flex gap-3">
						<button type="submit" class="border px-4 py-3.5 text-sm">
							{m.proposal_detail_accept_submit()}
						</button>
						<button
							type="submit"
							formaction="?/reject"
							class="border px-4 py-3.5 text-sm opacity-80"
						>
							{m.proposal_detail_reject_submit()}
						</button>
					</div>
				</form>
			{:else}
				<dl
					class="mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm [&_dd]:min-w-0 [&_dd]:break-words"
				>
					{#each fieldEntries as [field] (field)}
						<dt class="opacity-70">{proposalFieldLabel(field)}</dt>
						<dd>{String((data.proposal.acceptedFields ?? data.proposal.proposedFields)[field])}</dd>
					{/each}
				</dl>
			{/if}
		</section>
	</div>

	{#if data.proposal.status !== 'pending'}
		<section class="mt-6 border p-4">
			<h2 class="text-base font-medium">{m.proposal_detail_decided_heading()}</h2>
			<dl
				class="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm [&_dd]:min-w-0 [&_dd]:break-words"
			>
				<dt class="opacity-70">{m.proposal_detail_decided_by_label()}</dt>
				<dd>{data.proposal.decidedBy}</dd>
				<dt class="opacity-70">{m.proposal_detail_decided_at_label()}</dt>
				<dd>{data.proposal.decidedAt ? formatDateTime(data.proposal.decidedAt) : ''}</dd>
			</dl>

			{#if data.proposal.status === 'accepted'}
				<h3 class="mt-4 text-sm font-medium">{m.proposal_detail_changes_heading()}</h3>
				{#if data.proposal.changes.length === 0}
					<p class="mt-1 text-sm opacity-70">{m.proposal_detail_no_changes()}</p>
				{:else}
					<ul class="mt-1 flex flex-col gap-1 text-sm">
						{#each data.proposal.changes as change (change.field)}
							<li>
								{m.proposal_detail_change_row({
									field: proposalFieldLabel(change.field),
									proposed: String(change.proposed),
									accepted: String(change.accepted)
								})}
							</li>
						{/each}
					</ul>
				{/if}

				{#if data.proposal.resultId && data.proposal.targetType === 'work_unit'}
					<p class="mt-3 text-sm">
						<a href={resolve('/day/[id]', { id: data.proposal.resultId })} class="underline"
							>{m.proposal_detail_result_link()}</a
						>
					</p>
				{/if}
			{/if}
		</section>
	{/if}
</Page>
