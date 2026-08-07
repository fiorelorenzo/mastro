<script lang="ts">
	import * as m from '$lib/paraglide/messages';

	let { reimbursable }: { reimbursable: boolean } = $props();
</script>

<!--
	Mirrors `routes/day/DayStateBadge.svelte`'s guarantee: reimbursable and
	non-reimbursable each pair their own shape and fill with their colour
	token, so the distinction survives grayscale print and colour vision
	deficiency before the label is even read. Non-reimbursable is the state
	#28 needs unmistakable — the same class of fact as a day worked without
	approval — so it gets the bordered, hatched background treatment
	`day-state-worked_without_approval` uses.
-->
<span class="reimbursable-state" class:non-reimbursable={!reimbursable}>
	<svg class="glyph" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
		{#if reimbursable}
			<circle cx="8" cy="8" r="6.5" />
			<path class="mark" d="M5 8.2 7.1 10.3 11.2 5.7" />
		{:else}
			<path d="M8 1 15 14.5H1Z" stroke-width="1.8" />
			<path class="mark" d="M8 6V9.6" stroke-width="1.8" />
			<circle class="mark" cx="8" cy="12" r="0.9" stroke="none" fill="currentColor" />
		{/if}
	</svg>
	<span class="label"
		>{reimbursable ? m.expense_reimbursable_label() : m.expense_non_reimbursable_label()}</span
	>
</span>

<style>
	.reimbursable-state {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		color: var(--state-color);
		--state-color: var(--status-good);
	}
	.reimbursable-state.non-reimbursable {
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
</style>
