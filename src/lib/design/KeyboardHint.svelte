<script lang="ts">
	/**
	 * A `<kbd>`-styled shortcut hint — "N", "Ctrl+Invio" — meant to sit inside
	 * a `Button` label or beside an action. The 2026-08-13 UX review flagged
	 * these as rendered permanently at 9px grey, including on phones, where
	 * there is no keyboard to press: `@media (pointer: coarse)` hides it
	 * below the breakpoint instead. It is `aria-hidden` unconditionally — the
	 * shortcut is a sighted, keyboard-user affordance layered on top of an
	 * action that already has its own accessible name; reading "N" out of
	 * context adds noise, not information.
	 */
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

<kbd class="kbd" aria-hidden="true">{@render children()}</kbd>

<style>
	.kbd {
		font-family: var(--font-mono);
		font-size: var(--text-2xs);
		line-height: 1;
		border: 1px solid var(--line-strong);
		border-bottom-width: 2px;
		border-radius: var(--radius-sm);
		padding: 0 var(--space-1);
		color: var(--text-muted);
		background: var(--surface-2);
		white-space: nowrap;
	}

	/* No physical keyboard below this breakpoint — the hint is dead weight
	   on a phone, not a nuance. */
	@media (pointer: coarse) {
		.kbd {
			display: none;
		}
	}
</style>
