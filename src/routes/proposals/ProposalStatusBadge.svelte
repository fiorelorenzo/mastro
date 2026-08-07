<script lang="ts">
	import { proposalStatusLabel, type ProposalStatusValue } from './proposal-status';

	let { status }: { status: ProposalStatusValue } = $props();
</script>

<!--
	Same structural guarantee as `routes/day/DayStateBadge.svelte` and
	`$lib/design/charts/StatusIndicator.svelte`: every status pairs its own
	outline shape and glyph with its colour token, so the distinction
	survives grayscale print and colour vision deficiency before the label
	is read. The `pending` glyph deliberately reuses the day lifecycle's own
	`proposed` mark (a dashed circle) — the same visual vocabulary for the
	same idea, "recorded but not yet decided".
-->
<span class="status status-{status}">
	<svg class="glyph" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
		{#if status === 'pending'}
			<circle cx="8" cy="8" r="6.5" stroke-dasharray="1.6 1.6" />
			<circle class="mark" cx="5.4" cy="8" r="0.7" stroke="none" fill="currentColor" />
			<circle class="mark" cx="8" cy="8" r="0.7" stroke="none" fill="currentColor" />
			<circle class="mark" cx="10.6" cy="8" r="0.7" stroke="none" fill="currentColor" />
		{:else if status === 'accepted'}
			<circle cx="8" cy="8" r="6.5" />
			<path class="mark" d="M5 8.2 7.1 10.3 11.2 5.7" />
		{:else}
			<path d="M8 1.6 14.5 14.4H1.5Z" />
			<path class="mark" d="M5.8 5.8 10.2 10.2M10.2 5.8 5.8 10.2" />
		{/if}
	</svg>
	<span class="label">{proposalStatusLabel(status)}</span>
</span>

<style>
	.status {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		color: var(--state-color);
	}
	.status-pending {
		--state-color: var(--text-secondary);
	}
	.status-accepted {
		--state-color: var(--delta-good);
	}
	.status-rejected {
		--state-color: var(--status-warning);
	}
	.glyph {
		flex: none;
		fill: none;
		stroke: var(--state-color);
		stroke-width: 1.3;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.mark {
		stroke: var(--state-color);
	}
	.label {
		color: var(--text-primary);
		font-size: 0.8125rem;
	}
</style>
