<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as m from '$lib/paraglide/messages';
	import type { Crumb } from './crumbs';
	import { appHref } from './href';

	let {
		crumbs = [],
		title,
		subtitle,
		actions
	}: {
		/** Ancestors only, nearest last. The page itself is the title. */
		crumbs?: readonly Crumb[];
		title: string;
		subtitle?: string;
		actions?: Snippet;
	} = $props();

	const parent = $derived(crumbs.at(-1));
</script>

<header class="header">
	{#if parent}
		<nav class="trail" aria-label={m.page_header_breadcrumb_label()}>
			<ol>
				{#each crumbs as crumb, index (crumb.href)}
					<li>
						{#if index > 0}<span aria-hidden="true">›</span>{/if}
						<a href={appHref(crumb.href)}>{crumb.label}</a>
					</li>
				{/each}
			</ol>
		</nav>
		<!-- Below 640px the whole trail collapses to this one link. Both are in
		     the markup and CSS picks: a crumb list wide enough to wrap onto three
		     lines on a phone is worse than no trail at all. -->
		<a class="back" href={appHref(parent.href)}>
			{m.page_header_back_to({ parent: parent.label })}
		</a>
	{/if}
	<div class="row">
		<!-- The `title` attribute is the escape hatch for the two-line clamp
		     below: a record name long enough to clip still has its full text
		     one hover/long-press away, and the trail above already carries
		     whatever ancestor a caller might otherwise have concatenated in. -->
		<h1 {title}>{title}</h1>
		{#if actions}<div class="actions">{@render actions()}</div>{/if}
	</div>
	{#if subtitle}<p class="subtitle">{subtitle}</p>{/if}
</header>

<style>
	.header {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-bottom: 1.5rem;
	}
	.trail,
	.back {
		font-size: 0.875rem;
		color: var(--text-secondary);
	}
	.trail ol {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		list-style: none;
		padding: 0;
	}
	.trail li {
		display: flex;
		gap: 0.5rem;
	}
	.trail a {
		text-decoration: underline;
	}
	.back {
		text-decoration: underline;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem 1rem;
	}
	h1 {
		font-size: 1.5rem;
		font-weight: 600;
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		overflow: hidden;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 1rem;
	}
	.subtitle {
		color: var(--text-secondary);
	}
	/* The phone shape: one back link, actions under the title. */
	.trail {
		display: none;
	}
	@media (min-width: 640px) {
		.trail {
			display: block;
		}
		.back {
			display: none;
		}
	}
	@media (max-width: 639px) {
		.row {
			flex-direction: column;
			align-items: stretch;
		}
	}
</style>
