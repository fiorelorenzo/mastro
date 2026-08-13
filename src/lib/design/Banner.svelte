<script lang="ts">
	/*
	 * Banner.svelte — an in-context notice: a warning before something risky
	 * happens (day/new's "no written approval on this contract"), or a
	 * critical one after it did (day/[id]'s risk-state notice, an overdue
	 * invoice, a ceiling projected to cross). Distinct from `ErrorState`
	 * (replaces the whole page) and `Badge` (one word inline): a banner is
	 * prose plus an optional way forward, sitting inside a form or a detail
	 * view rather than the page itself (#207).
	 *
	 * `tone` never carries the meaning alone — the same discipline `Badge`
	 * and `StatusIndicator` already hold: every tone pairs its own glyph
	 * (`bannerGlyph`, sharing `Badge`'s own `BADGE_GLYPH` table) with its
	 * colour, so the distinction survives grayscale print and colour vision
	 * deficiency before the prose is even read.
	 */
	import type { Snippet } from 'svelte';
	import { bannerGlyph, bannerRole, type BannerTone } from './banner';

	let {
		tone,
		children,
		actions
	}: {
		tone: BannerTone;
		/** The notice itself — prose, may include inline emphasis. */
		children: Snippet;
		/** The way forward: a button, a link, or a small group of them. */
		actions?: Snippet;
	} = $props();
</script>

<div class="banner banner--{tone}" role={bannerRole(tone)}>
	<span class="glyph" aria-hidden="true">{bannerGlyph(tone)}</span>
	<div class="body">
		<div class="message">{@render children()}</div>
		{#if actions}<div class="actions">{@render actions()}</div>{/if}
	</div>
</div>

<style>
	.banner {
		display: flex;
		gap: var(--space-3);
		align-items: flex-start;
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-md);
		background: var(--surface-2);
		font-size: var(--text-sm);
	}
	.glyph {
		flex: none;
		line-height: 1.4;
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}
	.message {
		color: var(--text-primary);
	}
	.message :global(strong) {
		font-weight: var(--weight-medium);
	}
	.actions {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.banner--info {
		border-color: color-mix(in srgb, var(--color-primary) 45%, transparent);
		background: color-mix(in srgb, var(--color-primary) 10%, transparent);
	}
	.banner--info .glyph {
		color: var(--color-primary);
	}
	.banner--warning {
		border-color: color-mix(in srgb, var(--status-warning) 55%, transparent);
		background: color-mix(in srgb, var(--status-warning) 12%, transparent);
	}
	.banner--warning .glyph {
		color: color-mix(in srgb, var(--status-warning) 78%, var(--text-primary));
	}
	.banner--critical {
		border-color: color-mix(in srgb, var(--color-danger) 45%, transparent);
		background: color-mix(in srgb, var(--color-danger) 10%, transparent);
	}
	.banner--critical .glyph {
		color: var(--color-danger);
	}
</style>
