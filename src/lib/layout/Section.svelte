<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		title,
		actions,
		children
	}: {
		title: string;
		/** Section-scoped links, the "new rate card" kind. Page-scoped ones belong to PageHeader. */
		actions?: Snippet;
		children: Snippet;
	} = $props();
</script>

<section class="section">
	<div class="head">
		<h2>{title}</h2>
		{#if actions}<div class="actions">{@render actions()}</div>{/if}
	</div>
	{@render children()}
</section>

<style>
	/*
	 * One spacing scale, so two pages cannot disagree about it.
	 *
	 * This rule assumes sections stack in normal flow, and CSS cannot ask
	 * about its parent's display, so a section that is a *grid or flex item*
	 * still matches it and starts 2rem lower than the item beside it. That
	 * was #386 on the contract page, where rate cards sat 32px below
	 * invoices for exactly this reason. No page pairs sections in a row any
	 * more; one that wants to must zero this margin on its own items
	 * (`.row > :global(.section) { margin-top: 0 }`), because the gap
	 * belongs to the row then, not to the section.
	 */
	.section + :global(.section) {
		margin-top: 2rem;
	}
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem 1rem;
		margin-bottom: 0.75rem;
	}
	h2 {
		font-size: 1.125rem;
		font-weight: 600;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		font-size: 0.875rem;
	}
</style>
