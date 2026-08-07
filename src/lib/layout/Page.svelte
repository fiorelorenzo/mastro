<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Crumb } from '$lib/nav/crumbs';
	import PageHeader from '$lib/nav/PageHeader.svelte';

	let {
		title,
		subtitle,
		crumbs,
		actions,
		width = 'text',
		children
	}: {
		title: string;
		subtitle?: string;
		crumbs?: readonly Crumb[];
		actions?: Snippet;
		/**
		 * `wide` is for the pages carrying a table with more than four
		 * columns. A name rather than a number, so a third page cannot
		 * invent its own max-width.
		 */
		width?: 'text' | 'wide';
		children: Snippet;
	} = $props();
</script>

<main class="page" class:wide={width === 'wide'}>
	<PageHeader {crumbs} {title} {subtitle} {actions} />
	{@render children()}
</main>

<style>
	.page {
		margin-inline: auto;
		max-width: 48rem;
		padding: 2rem;
	}
	.wide {
		max-width: 72rem;
	}
	@media (max-width: 639px) {
		.page {
			padding: 1rem;
		}
	}
</style>
