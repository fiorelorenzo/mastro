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
	/* One spacing scale, so two pages cannot disagree about it. */
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
