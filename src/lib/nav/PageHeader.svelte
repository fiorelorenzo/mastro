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
		<!-- Title and subtitle share one line when they fit (#366). They were
		     two stacked blocks at every width, which on a phone spent three
		     rows of a short viewport on "Today" and a date that read as one
		     phrase. `flex-wrap` on `.titles` keeps the old behaviour for the
		     long pairs: a record name plus a long subtitle still wraps, it
		     just no longer wraps when there is room.

		     The `title` attribute is the escape hatch for the two-line clamp
		     below: a record name long enough to clip still has its full text
		     one hover/long-press away, and the trail above already carries
		     whatever ancestor a caller might otherwise have concatenated in. -->
		<div class="titles">
			<h1 {title}>{title}</h1>
			{#if subtitle}<p class="subtitle">{subtitle}</p>{/if}
		</div>
		{#if actions}<div class="actions">{@render actions()}</div>{/if}
	</div>
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
	.titles {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.25rem 0.75rem;
		min-width: 0;
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
		margin: 0;
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
