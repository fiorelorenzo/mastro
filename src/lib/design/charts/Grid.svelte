<script lang="ts">
	let {
		orientation,
		lines,
		length
	}: {
		/** `horizontal` lines run left-right at each y in `lines`; `vertical` run top-bottom at each x. */
		orientation: 'horizontal' | 'vertical';
		lines: readonly number[];
		/** Span of each line in px (the plot's width for horizontal lines, height for vertical). */
		length: number;
	} = $props();
</script>

<!-- Decorative: recessive hairline grid, one step off the surface, never
     dashed. Keyed by index: two lines can coincide when a scale collapses,
     and a duplicate key would take the page down with it (#143). -->
<g class="grid" aria-hidden="true">
	{#each lines as position, i (i)}
		{#if orientation === 'horizontal'}
			<line x1="0" y1={position} x2={length} y2={position} />
		{:else}
			<line x1={position} y1="0" x2={position} y2={length} />
		{/if}
	{/each}
</g>

<style>
	.grid line {
		stroke: var(--grid-line);
		stroke-width: 1;
		shape-rendering: crispEdges;
	}
</style>
