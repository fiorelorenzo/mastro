<!--
	Tabs.svelte — a row of links that switch which slice of one list is
	showing (#238's "tabs for all/to collect/overdue/paid"). Each tab is a
	real URL (`?tab=…`), never a same-page panel swap: a filtered view is
	bookmarkable, shareable and works with no JS — the same reason every
	invoice being "reachable from the interface" has to survive without
	assuming a script ran.

	That is also why this is plain links with `aria-current`, the pattern
	PageHeader's own breadcrumb trail already uses, rather than
	`role="tablist"`/`role="tab"`: the ARIA tab pattern assumes activating a
	tab does not navigate the page, and these do.
-->
<script lang="ts">
	import { appHref } from '$lib/nav/href';
	import Badge from './Badge.svelte';
	import type { BadgeVariant } from './badge-variants';

	let {
		label,
		tabs
	}: {
		/** Accessible name for the group — a nav landmark is never unlabelled. */
		label: string;
		tabs: readonly {
			href: string;
			label: string;
			selected: boolean;
			/** A colour-and-glyph count next to the label — how many rows this tab holds, when that number itself matters (unpaid, overdue). */
			badge?: { variant: BadgeVariant; count: number };
		}[];
	} = $props();
</script>

<nav class="tabs" aria-label={label}>
	{#each tabs as tab (tab.href)}
		<a
			class="tab"
			class:selected={tab.selected}
			href={appHref(tab.href)}
			aria-current={tab.selected ? 'page' : undefined}
		>
			<span>{tab.label}</span>
			{#if tab.badge}
				<Badge variant={tab.badge.variant} label={String(tab.badge.count)} size="sm" />
			{/if}
		</a>
	{/each}
</nav>

<style>
	.tabs {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
		border-bottom: 1px solid var(--line);
	}
	.tab {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		margin-bottom: -1px;
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		color: var(--text-secondary);
		text-decoration: none;
		border-bottom: 2px solid transparent;
	}
	.tab:hover {
		color: var(--text-primary);
	}
	.tab.selected {
		color: var(--text-primary);
		border-bottom-color: var(--color-primary);
	}
</style>
