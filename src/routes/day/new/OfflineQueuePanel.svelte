<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { formatDate, formatDays } from '$lib/i18n/format';
	import { StatusIndicator } from '$lib/design';
	import { offlineQueue } from '$lib/pwa/offline-queue.svelte';

	interface ContractOption {
		id: string;
		clientName: string;
		title: string;
	}

	let { contracts }: { contracts: ContractOption[] } = $props();

	function contractLabel(contractId: string): string {
		const contract = contracts.find((c) => c.id === contractId);
		return contract ? `${contract.clientName} — ${contract.title}` : contractId;
	}
</script>

<!--
	Every entry here is a day the server has not recorded yet (#62) — this
	list is never allowed to look like the ledger. There is no link to
	/day/[id], no state badge from DayStateBadge.svelte, nothing an
	inattentive glance could mistake for a saved day: only a StatusIndicator
	(warning while it waits or syncs, critical once the server has refused
	it), so the distinction survives even a skim.
-->
{#if offlineQueue.entries.length > 0}
	<section class="offline-queue" aria-label={m.day_offline_pending_heading()}>
		<h2 class="text-base font-semibold">{m.day_offline_pending_heading()}</h2>
		<ul class="mt-2 flex flex-col gap-3">
			{#each offlineQueue.entries as entry (entry.id)}
				<li class="entry" role="status">
					<div class="entry-summary">
						<span class="entry-scope">{entry.fields.scope}</span>
						<span class="entry-meta">
							{formatDate(entry.fields.date)} · {formatDays(Number(entry.fields.quantity))} ·
							{contractLabel(entry.fields.contractId)}
						</span>
					</div>
					{#if entry.status === 'failed'}
						<div class="entry-status">
							<StatusIndicator level="critical" label={entry.error ?? ''} />
							<button type="button" class="dismiss" onclick={() => offlineQueue.dismiss(entry.id)}>
								{m.day_offline_pending_dismiss()}
							</button>
						</div>
					{:else if entry.status === 'syncing'}
						<StatusIndicator level="warning" label={m.day_offline_pending_status_syncing()} />
					{:else}
						<StatusIndicator level="warning" label={m.day_offline_pending_status_pending()} />
					{/if}
				</li>
			{/each}
		</ul>
	</section>
{/if}

<style>
	.offline-queue {
		margin-top: 1.5rem;
		border-top: 1px solid var(--border-hairline);
		padding-top: 1rem;
	}
	.entry {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		border: 1px solid var(--border-hairline);
		padding: 0.75rem 1rem;
	}
	.entry-summary {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}
	.entry-scope {
		font-weight: 500;
	}
	.entry-meta {
		font-size: 0.8125rem;
		opacity: 0.7;
	}
	.entry-status {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.375rem;
	}
	.dismiss {
		border: 1px solid var(--border-hairline);
		padding: 0.25rem 0.625rem;
		font-size: 0.8125rem;
	}
</style>
