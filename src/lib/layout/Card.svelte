<script lang="ts">
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

<div class="card">{@render children()}</div>

<style>
	/* A hairline on the page surface, and nothing else: no shadow, no radius,
	   no token that does not already exist. */
	.card {
		border: 1px solid var(--border-hairline);
		padding: 0.75rem 1rem;
	}
</style>
