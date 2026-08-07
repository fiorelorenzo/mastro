<script lang="ts">
	import { workUnitStateLabel, type WorkUnitStateValue } from './work-unit-state';

	let {
		state,
		compact = false
	}: {
		state: WorkUnitStateValue;
		/** Smaller glyph and label, for a calendar grid cell rather than a
		 * detail page or list row. */
		compact?: boolean;
	} = $props();
</script>

<!--
	Every state below pairs its own outline shape, fill style and inner mark
	with its colour token, so the distinction survives grayscale print and
	full-severity colour vision deficiency before the label is even read —
	the same structural guarantee `$lib/design/charts/StatusIndicator.svelte`
	establishes for the four-level status scale. `worked_without_approval` is
	the one state the product needs unmistakable (epic #2): it is the only
	one that gets the bordered, hatched background, on top of its own bold
	triangle-and-exclamation glyph.
-->
<span class="day-state day-state-{state}" class:compact>
	<svg
		class="glyph"
		viewBox="0 0 16 16"
		width={compact ? 13 : 16}
		height={compact ? 13 : 16}
		aria-hidden="true"
	>
		{#if state === 'proposed'}
			<circle cx="8" cy="8" r="6.5" stroke-dasharray="1.6 1.6" />
			<circle class="mark" cx="5.4" cy="8" r="0.7" stroke="none" fill="currentColor" />
			<circle class="mark" cx="8" cy="8" r="0.7" stroke="none" fill="currentColor" />
			<circle class="mark" cx="10.6" cy="8" r="0.7" stroke="none" fill="currentColor" />
		{:else if state === 'approved'}
			<circle cx="8" cy="8" r="6.5" />
			<path class="mark" d="M5 8.2 7.1 10.3 11.2 5.7" />
		{:else if state === 'worked'}
			<circle cx="8" cy="8" r="6.5" fill-opacity="0.18" />
			<path class="mark" d="M5 8.2 7.1 10.3 11.2 5.7" />
		{:else if state === 'worked_without_approval'}
			<path d="M8 1 15 14.5H1Z" stroke-width="1.8" />
			<path class="mark" d="M8 6V9.6" stroke-width="1.8" />
			<circle class="mark" cx="8" cy="12" r="0.9" stroke="none" fill="currentColor" />
		{:else if state === 'invoiced'}
			<path d="M8 1 15 8 8 15 1 8Z" />
			<path class="mark" d="M6.2 6.2H9.8M6.2 8H9.8M6.2 9.8H8.6" />
		{:else if state === 'paid'}
			<path d="M8 1 15 8 8 15 1 8Z" fill-opacity="0.18" />
			<path class="mark" d="M5.2 8.2 7.1 10.1 10.8 5.9" />
		{:else if state === 'disputed'}
			<rect x="1.5" y="1.5" width="13" height="13" rx="2" />
			<path class="mark" d="M8 5V9" />
			<circle class="mark" cx="8" cy="11.3" r="0.9" stroke="none" fill="currentColor" />
		{:else if state === 'revoked'}
			<rect x="1.5" y="1.5" width="13" height="13" rx="2" stroke-dasharray="2 1.6" />
			<path class="mark" d="M5 8H11" />
		{:else if state === 'rejected'}
			<path d="M8 1.6 14.5 14.4H1.5Z" />
			<path class="mark" d="M5.8 5.8 10.2 10.2M10.2 5.8 5.8 10.2" />
		{:else}
			<rect x="1.5" y="1.5" width="13" height="13" rx="2" fill-opacity="0.14" />
			<path class="mark" d="M4 12 12 4" />
		{/if}
	</svg>
	<span class="label">{workUnitStateLabel(state)}</span>
</span>

<style>
	.day-state {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		color: var(--state-color);
	}
	.day-state.compact {
		gap: 0.25rem;
	}
	.day-state-proposed {
		--state-color: var(--text-secondary);
	}
	.day-state-approved {
		--state-color: var(--series-3);
	}
	.day-state-worked {
		--state-color: var(--certainty-pipeline);
	}
	.day-state-worked_without_approval {
		--state-color: var(--status-critical);
		font-weight: 600;
		border: 1px solid var(--status-critical);
		border-radius: 4px;
		padding: 0.1875rem 0.5rem;
		background-color: color-mix(in oklch, var(--status-critical) 10%, transparent);
		background-image: repeating-linear-gradient(
			45deg,
			color-mix(in oklch, var(--status-critical) 35%, transparent) 0,
			color-mix(in oklch, var(--status-critical) 35%, transparent) 1px,
			transparent 1px,
			transparent 6px
		);
	}
	.day-state-invoiced {
		--state-color: var(--certainty-projected);
	}
	.day-state-paid {
		--state-color: var(--delta-good);
	}
	.day-state-disputed {
		--state-color: var(--status-serious);
	}
	.day-state-revoked {
		--state-color: var(--text-muted);
	}
	.day-state-rejected {
		--state-color: var(--status-warning);
	}
	.day-state-unbillable {
		--state-color: var(--text-muted);
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
		line-height: 1.15;
	}
	.compact .label {
		font-size: 0.625rem;
	}
</style>
