<script lang="ts">
	// The shell-wide half of #227: `OfflineQueuePanel` (day/new) already
	// renders every queued entry inline, but only while that one page is
	// mounted — the review's finding 19 ("the offline queue is invisible
	// outside the one page that writes to it") is about every *other*
	// screen. Mounted once from the root layout, this is the queue's
	// second reader; its own `onMount` below is also, deliberately, the
	// call site `offlineQueue.init()`'s doc comment asks for ("call once,
	// from a component's onMount") that survives navigation — the layout
	// this is mounted from never unmounts while signed in, so the
	// `online` listener and the replay-on-reopen pass no longer live and
	// die with whichever page happened to write the entry.
	import { onMount } from 'svelte';
	import * as m from '$lib/paraglide/messages';
	import { formatDate, formatDateTime, formatDays } from '$lib/i18n/format';
	import { Badge, StatusIndicator } from '$lib/design';
	import { offlineQueue } from './offline-queue.svelte';
	import { queueSeverity } from './offline-queue';

	onMount(() => offlineQueue.init());

	let panel: HTMLDialogElement | undefined = $state();

	const severity = $derived(queueSeverity(offlineQueue.entries));
	const orderedEntries = $derived(
		[...offlineQueue.entries].sort((a, b) =>
			a.queuedAt < b.queuedAt ? -1 : a.queuedAt > b.queuedAt ? 1 : 0
		)
	);

	// Mirrors the native "click outside to close" pattern BottomBar's own
	// sheet uses, but checked against `event.target` rather than closing
	// on any click inside: a click on the per-entry "Dismiss" button below
	// must dismiss that entry without also closing the whole panel.
	function onBackdropClick(event: MouseEvent) {
		if (event.target === panel) panel?.close();
	}
</script>

<!--
	Hidden entirely once the queue is empty — this is a queue indicator,
	not chrome that permanently occupies a corner of the screen. No state
	badge from day-state-badge.ts here either, same reasoning
	OfflineQueuePanel's own header comment gives: nothing here should be
	mistakable for a saved ledger row.
-->
{#if offlineQueue.entries.length > 0}
	<div class="indicator">
		<button type="button" class="trigger" aria-haspopup="dialog" onclick={() => panel?.showModal()}>
			<Badge
				variant={severity}
				label={m.day_offline_queue_indicator_count({ count: offlineQueue.entries.length })}
			/>
			<span class="last-synced">
				{offlineQueue.lastSyncedAt
					? m.day_offline_queue_indicator_last_synced({
							time: formatDateTime(offlineQueue.lastSyncedAt)
						})
					: m.day_offline_queue_indicator_never_synced()}
			</span>
		</button>
	</div>

	<dialog
		bind:this={panel}
		class="panel"
		onclick={onBackdropClick}
		aria-labelledby="offline-queue-indicator-heading"
	>
		<div class="panel-inner">
			<div class="panel-head">
				<h2 id="offline-queue-indicator-heading" class="text-base font-semibold">
					{m.day_offline_pending_heading()}
				</h2>
				<button type="button" class="close" onclick={() => panel?.close()}>
					{m.day_offline_queue_indicator_close()}
				</button>
			</div>
			<p class="last-synced-detail">
				{offlineQueue.lastSyncedAt
					? m.day_offline_queue_indicator_last_synced({
							time: formatDateTime(offlineQueue.lastSyncedAt)
						})
					: m.day_offline_queue_indicator_never_synced()}
			</p>
			<ul class="entries">
				{#each orderedEntries as entry (entry.id)}
					<li class="entry">
						<div class="entry-summary">
							<span class="entry-scope">{entry.fields.scope}</span>
							<span class="entry-meta">
								{formatDate(entry.fields.date)} · {formatDays(Number(entry.fields.quantity))}
							</span>
						</div>
						{#if entry.status === 'failed'}
							<div class="entry-status">
								<StatusIndicator
									level="critical"
									label={entry.error ?? m.day_offline_sync_failed_generic()}
								/>
								<button
									type="button"
									class="dismiss"
									onclick={() => offlineQueue.dismiss(entry.id)}
								>
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
		</div>
	</dialog>
{/if}

<style>
	.indicator {
		position: fixed;
		z-index: 40;
		top: 0.75rem;
		right: 0.75rem;
	}
	.trigger {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 2.75rem;
		border: 1px solid var(--border-hairline);
		background: var(--surface-page);
		border-radius: 999px;
		padding: 0.375rem 0.75rem;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.16);
	}
	.last-synced {
		font-size: 0.75rem;
		color: var(--text-secondary);
		white-space: nowrap;
	}
	@media (max-width: 899px) {
		.indicator {
			top: auto;
			right: auto;
			left: 1rem;
			/* Mirrors BottomBar's own FAB offset (52px tab bar + safe area)
			   so the two never overlap; FAB sits bottom-right, this sits
			   bottom-left. */
			bottom: calc(52px + env(safe-area-inset-bottom) + 0.75rem);
		}
		.last-synced {
			display: none;
		}
	}

	.panel {
		border: 1px solid var(--border-hairline);
		background: var(--surface-page);
		color: var(--text-primary);
		padding: 0;
		width: min(420px, calc(100vw - 1.5rem));
		max-height: min(70vh, 32rem);
		overflow: auto;
	}
	.panel::backdrop {
		background: rgba(0, 0, 0, 0.32);
	}
	@media (min-width: 900px) {
		.panel {
			margin: 4.5rem 0.75rem auto auto;
		}
	}
	@media (max-width: 899px) {
		.panel {
			margin: auto auto 0 auto;
			width: 100%;
			border-left: 0;
			border-right: 0;
			border-bottom: 0;
			max-height: 60vh;
		}
	}
	.panel-inner {
		padding: 1rem 1.25rem 1.25rem;
	}
	.panel-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}
	.close {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
		border: 1px solid var(--border-hairline);
		padding: 0.5rem 0.875rem;
		font-size: 0.8125rem;
	}
	.last-synced-detail {
		margin: 0.25rem 0 0.75rem;
		font-size: 0.8125rem;
		color: var(--text-secondary);
	}
	.entries {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
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
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
		border: 1px solid var(--border-hairline);
		padding: 0.5rem 0.875rem;
		font-size: 0.8125rem;
	}
</style>
