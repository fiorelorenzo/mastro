<!--
	The one "nothing here" shape the review counted twelve near-duplicate,
	dead-end one-liners of (2026-08-13 UX/UI review). A glyph, a title, a
	body and a way forward — deliberately generic enough to carry three
	different intents with copy alone, not markup: a brand-new instance
	("nothing yet, here is how to start"), a filtered list with no matches
	("nothing matches, clear the filter"), and a legitimately empty period
	("no days this month"). The mockup draws all three side by side under
	"Stati vuoti, tre significati diversi".

	`role="status"` because the common real trigger is a filter clearing a
	list client-side: the row count changes to zero with no page navigation,
	and nothing else here was going to announce that (the review counted
	zero `aria-live` regions in the whole product).
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		icon,
		title,
		body,
		actions
	}: {
		/** A single glyph, decorative — the title carries the meaning, not this. */
		icon: string;
		title: string;
		body: string;
		/** The way forward: a button, a link, or a small group of them. */
		actions?: Snippet;
	} = $props();
</script>

<div class="empty" role="status">
	<span class="icon" aria-hidden="true">{icon}</span>
	<p class="title">{title}</p>
	<p class="body">{body}</p>
	{#if actions}<div class="actions">{@render actions()}</div>{/if}
</div>

<style>
	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-7) var(--space-4);
		text-align: center;
	}
	.icon {
		font-size: var(--text-2xl);
		line-height: 1;
		color: var(--text-muted);
	}
	.title {
		margin: 0;
		font-size: var(--text-lg);
		font-weight: var(--weight-medium);
		color: var(--text-primary);
	}
	.body {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-secondary);
		max-width: 42ch;
	}
	.actions {
		margin-top: var(--space-2);
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
		justify-content: center;
	}
</style>
