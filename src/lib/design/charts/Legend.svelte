<script lang="ts">
	import StatusIndicator from './StatusIndicator.svelte';
	import type { SeriesEntry, StatusEntry } from './types';

	let {
		entries = [],
		statusEntries = [],
		activeIds,
		onToggle
	}: {
		/** Categorical/ordinal series. Rendered only from 2 entries up — a single series is named by the chart's title, not a legend box. */
		entries?: readonly SeriesEntry[];
		/** Status pairings (icon + label), always rendered regardless of count. */
		statusEntries?: readonly StatusEntry[];
		/** Ids currently shown; omit to treat every entry as active. Isolating one keeps the others' colors — filtering never reassigns hue. */
		activeIds?: ReadonlySet<string>;
		onToggle?: (id: string) => void;
	} = $props();

	const showSeries = $derived(entries.length >= 2);
</script>

<div class="legend">
	{#if showSeries}
		<ul class="series">
			{#each entries as entry (entry.id)}
				{@const active = activeIds === undefined || activeIds.has(entry.id)}
				<li>
					<button
						type="button"
						class="swatch-button"
						class:inactive={!active}
						aria-pressed={active}
						onclick={() => onToggle?.(entry.id)}
					>
						{#if entry.mark === 'line'}
							<svg
								class="mark mark-line"
								viewBox="0 0 16 4"
								width="16"
								height="4"
								aria-hidden="true"
							>
								<line x1="0" y1="2" x2="16" y2="2" style:stroke={entry.color} />
							</svg>
						{:else}
							<svg
								class="mark mark-rect"
								viewBox="0 0 12 12"
								width="12"
								height="12"
								aria-hidden="true"
							>
								<rect width="12" height="12" rx="2" style:fill={entry.color} />
							</svg>
						{/if}
						<span class="label">{entry.label}</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
	{#if statusEntries.length}
		<ul class="statuses">
			{#each statusEntries as entry (entry.level)}
				<li><StatusIndicator level={entry.level} label={entry.label} /></li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem 1.5rem;
	}
	.series,
	.statuses {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 1rem;
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.swatch-button {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		border: none;
		background: none;
		padding: 0.125rem 0;
		cursor: pointer;
		color: var(--text-primary);
		font: inherit;
	}
	.swatch-button.inactive {
		color: var(--text-muted);
		opacity: 0.55;
	}
	.mark {
		flex: none;
	}
	.label {
		font-size: 0.8125rem;
	}
</style>
