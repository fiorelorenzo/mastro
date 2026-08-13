<!--
	The same shell as EmptyState, for a state that is wrong rather than
	simply empty. In place of the decorative glyph, a status chip — so the
	status code is never, on its own, the entire message the way the
	unstyled bundled SvelteKit fallback rendered it (`+error.svelte` exists
	specifically to stop that). Title names what went wrong, body explains
	it in prose, actions is always a way out: an error page with no path
	forward is a dead end, not a state.

	`role="alert"` rather than `role="status"`: this is the assertive
	sibling — worth interrupting, the same way a saving form's failure
	should be (2026-08-13 review: zero `aria-live` regions in the product).
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { errorSeverity } from './error-status';

	let {
		status,
		title,
		message,
		actions
	}: {
		status: number;
		title: string;
		/** The explanation, already resolved to prose by the caller. */
		message: string;
		/** The way out: a button, a link, or a small group of them. */
		actions?: Snippet;
	} = $props();

	const severity = $derived(errorSeverity(status));
</script>

<div class="error" role="alert">
	<span class="chip chip--{severity}">{status}</span>
	<h2 class="title">{title}</h2>
	<p class="body">{message}</p>
	{#if actions}<div class="actions">{@render actions()}</div>{/if}
</div>

<style>
	.error {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-7) var(--space-4);
		text-align: center;
	}
	.chip {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		padding: var(--space-1) var(--space-3);
		border-radius: var(--radius-full);
		border: 1px solid transparent;
	}
	.chip--warning {
		color: color-mix(in srgb, var(--status-warning) 78%, var(--text-primary));
		border-color: color-mix(in srgb, var(--status-warning) 55%, transparent);
		background: color-mix(in srgb, var(--status-warning) 16%, transparent);
	}
	.chip--critical {
		color: var(--color-danger);
		border-color: color-mix(in srgb, var(--color-danger) 50%, transparent);
		background: color-mix(in srgb, var(--color-danger) 12%, transparent);
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
		max-width: 48ch;
	}
	.actions {
		margin-top: var(--space-2);
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
		justify-content: center;
	}
</style>
