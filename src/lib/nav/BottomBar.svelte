<script lang="ts">
	import { resolve } from '$app/paths';
	import type { ResolvedPathname } from '$app/types';
	import * as m from '$lib/paraglide/messages';
	import { BOTTOM_BAR_HREFS, NAV_GROUPS, isNavItemActive } from './items';

	let { pathname, unreadAlerts }: { pathname: string; unreadAlerts: number } = $props();

	const all = NAV_GROUPS.flatMap((group) => group.items);
	const bar = BOTTOM_BAR_HREFS.map((href) => all.find((item) => item.href === href)!);
	const rest = all.filter((item) => !BOTTOM_BAR_HREFS.includes(item.href));

	let sheet: HTMLDialogElement | undefined = $state();

	// NavItem.href is a plain string by contract (see items.ts), not one of
	// the literal route ids `resolve()` expects — the values are exactly the
	// app's own routes, so this is a type-level widening of an otherwise
	// valid call, kept in one place instead of casting at every call site.
	function navHref(href: string): ResolvedPathname {
		return (resolve as (path: string) => string)(href) as ResolvedPathname;
	}
</script>

<nav class="bar" aria-label={m.nav_primary_label()}>
	{#each bar as item (item.href)}
		{@const active = isNavItemActive(item.href, pathname)}
		<a
			href={navHref(item.href)}
			class="tab"
			class:active
			aria-current={active ? 'page' : undefined}
		>
			{item.label()}
		</a>
	{/each}
	<button type="button" class="tab" onclick={() => sheet?.showModal()}>
		{m.nav_more()}
		{#if unreadAlerts > 0}<span class="dot" aria-hidden="true"></span>{/if}
	</button>
</nav>

<dialog bind:this={sheet} class="sheet" onclick={() => sheet?.close()}>
	<ul>
		{#each rest as item (item.href)}
			<li>
				<a href={navHref(item.href)} class="row">
					{item.label()}
					{#if item.badge === 'alerts' && unreadAlerts > 0}
						<span>{unreadAlerts}</span>
					{/if}
				</a>
			</li>
		{/each}
	</ul>
</dialog>

<style>
	.bar {
		position: fixed;
		inset: auto 0 0 0;
		display: grid;
		grid-auto-flow: column;
		grid-auto-columns: 1fr;
		border-top: 1px solid var(--border-hairline);
		background: var(--surface-page);
		padding-bottom: env(safe-area-inset-bottom);
	}
	.tab {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.25rem;
		min-height: 52px;
		font-size: 0.8125rem;
		color: var(--text-secondary);
		border-top: 3px solid transparent;
	}
	.tab.active {
		border-top-color: var(--text-primary);
		color: var(--text-primary);
		font-weight: 600;
	}
	.dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 999px;
		background: var(--status-warning);
	}
	.sheet {
		margin: auto auto 0 auto;
		width: 100%;
		border: 0;
		border-top: 1px solid var(--border-hairline);
		background: var(--surface-page);
		color: var(--text-primary);
	}
	.row {
		display: flex;
		justify-content: space-between;
		min-height: 48px;
		align-items: center;
		padding: 0 1rem;
	}
</style>
