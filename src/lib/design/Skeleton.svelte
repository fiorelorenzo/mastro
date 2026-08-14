<!--
	Skeleton.svelte — a shape-only loading placeholder (#207: "a loading
	list has nothing to show" from the issue body). `aria-hidden`
	unconditionally: a skeleton carries no information a screen reader
	should announce, and the region it sits inside is expected to own its
	own "loading"/`aria-busy` state (a `Table`'s own empty/loading slot, a
	list wrapped in one `role="status"`) — this component only ever draws
	the shape, never the announcement.
-->
<script lang="ts">
	import { skeletonLineWidths, type SkeletonShape } from './skeleton';

	let {
		shape = 'block',
		lines = 3,
		width,
		height
	}: {
		shape?: SkeletonShape;
		/** Only meaningful for `shape="text"`: how many placeholder lines. */
		lines?: number;
		/** Ignored for `shape="text"`, which sizes itself from `lines`. */
		width?: string;
		height?: string;
	} = $props();

	const widths = $derived(shape === 'text' ? skeletonLineWidths(lines) : []);
</script>

{#if shape === 'text'}
	<span class="lines" aria-hidden="true">
		{#each widths as lineWidth, index (index)}
			<span class="bone bone--text" style:width="{lineWidth}%"></span>
		{/each}
	</span>
{:else}
	<span class="bone bone--{shape}" aria-hidden="true" style:width style:height></span>
{/if}

<style>
	.lines {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.bone {
		display: block;
		background: var(--line);
		border-radius: var(--radius-sm);
	}
	.bone--text {
		height: 0.9em;
	}
	.bone--circle {
		width: 40px;
		height: 40px;
		border-radius: var(--radius-full);
	}
	.bone--block {
		width: 100%;
		height: 80px;
	}

	/* No animation that fights `prefers-reduced-motion` (#207) — the pulse
	   only runs under the default "no strong preference either way". */
	@media (prefers-reduced-motion: no-preference) {
		.bone {
			animation: pulse 1.6s ease-in-out infinite;
		}
	}
	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.5;
		}
	}
</style>
