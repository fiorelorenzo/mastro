<script lang="ts">
	import { resolve } from '$app/paths';
	import type { ResolvedPathname } from '$app/types';
	import * as m from '$lib/paraglide/messages';
	import LanguageSwitch from '$lib/components/LanguageSwitch.svelte';
	import { NAV_GROUPS, isNavItemActive } from './items';

	let {
		pathname,
		unreadAlerts,
		user
	}: {
		pathname: string;
		unreadAlerts: number;
		user: { email: string } | null;
	} = $props();

	// NavItem.href is a plain string by contract (see items.ts), not one of
	// the literal route ids `resolve()` expects — the values are exactly the
	// app's own routes, so this is a type-level widening of an otherwise
	// valid call, kept in one place instead of casting at every call site.
	function navHref(href: string): ResolvedPathname {
		return (resolve as (path: string) => string)(href) as ResolvedPathname;
	}
</script>

<nav class="sidebar" aria-label={m.nav_primary_label()}>
	<a class="brand" href={resolve('/')}>mastro</a>

	{#each NAV_GROUPS as group, groupIndex (groupIndex)}
		<ul class="group">
			{#each group.items as item (item.href)}
				{@const active = isNavItemActive(item.href, pathname)}
				<li>
					<a
						href={navHref(item.href)}
						class="item"
						class:active
						aria-current={active ? 'page' : undefined}
					>
						<span>{item.label()}</span>
						{#if item.badge === 'alerts' && unreadAlerts > 0}
							<span class="badge" aria-label={m.nav_alert_count({ count: unreadAlerts })}>
								{unreadAlerts}
							</span>
						{/if}
					</a>
				</li>
			{/each}
		</ul>
	{/each}

	{#if user}
		<div class="foot">
			<p class="email">{user.email}</p>
			<LanguageSwitch />
			<form method="POST" action="/sign-out"><button type="submit">{m.sign_out()}</button></form>
		</div>
	{/if}
</nav>

<style>
	.sidebar {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		width: 240px;
		height: 100svh;
		padding: 1rem;
		overflow-y: auto;
		border-right: 1px solid var(--border-hairline);
	}
	.brand {
		font-weight: 600;
	}
	.group {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		list-style: none;
		padding: 0;
	}
	.group + .group {
		padding-top: 1rem;
		border-top: 1px solid var(--border-hairline);
	}
	.item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		min-height: 44px;
		padding: 0 0.75rem;
		/* The active mark is a border and a weight, never colour alone. */
		border-left: 3px solid transparent;
		color: var(--text-secondary);
	}
	.item.active {
		border-left-color: var(--text-primary);
		color: var(--text-primary);
		font-weight: 600;
	}
	.badge {
		min-width: 1.5rem;
		padding: 0 0.375rem;
		border: 1px solid var(--border-hairline);
		border-radius: 999px;
		font-size: 0.75rem;
		text-align: center;
	}
	.foot {
		margin-top: auto;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding-top: 1rem;
		border-top: 1px solid var(--border-hairline);
		font-size: 0.875rem;
	}
	.email {
		color: var(--text-muted);
		overflow-wrap: anywhere;
	}
</style>
