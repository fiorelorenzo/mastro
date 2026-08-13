<script lang="ts">
	// The desktop nav rail (#148, #233). Groups follow the daily loop —
	// Today/Review/Calendar, then the Ledger, then the Inbox, then Settings
	// — reading `NAV_GROUPS` so this and `BottomBar` can never disagree
	// about what exists or which item is active.
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import { appHref } from './href';
	import LanguageSwitch from '$lib/components/LanguageSwitch.svelte';
	import Badge from '$lib/design/Badge.svelte';
	import { NAV_GROUPS, isNavItemActive } from './items';

	let {
		pathname,
		counts,
		user
	}: {
		pathname: string;
		/** The two nav counts that mean something: proposals waiting on a
		 *  human, invoices actually overdue — not a generic unread tally. */
		counts: { proposals: number; overdueInvoices: number };
		user: { email: string } | null;
	} = $props();
</script>

<nav class="sidebar" aria-label={m.nav_primary_label()}>
	<a class="brand" href={resolve('/')}>mastro</a>

	{#each NAV_GROUPS as group, groupIndex (groupIndex)}
		<div class="group">
			{#if group.title}<p class="title">{group.title()}</p>{/if}
			<ul class="items">
				{#each group.items as item (item.href)}
					{@const active = isNavItemActive(item.href, pathname)}
					{@const count = item.badge ? counts[item.badge] : 0}
					<li>
						<a
							href={appHref(item.href)}
							class="item"
							class:active
							aria-current={active ? 'page' : undefined}
						>
							<span class="ico" aria-hidden="true">{item.icon}</span>
							<span class="label">{item.label()}</span>
							{#if count > 0}
								<span
									class="count"
									aria-label={item.badge === 'proposals'
										? m.nav_proposals_count({ count })
										: m.nav_overdue_invoices_count({ count })}
								>
									<Badge variant="count" size="sm" label={count > 99 ? '99+' : String(count)} />
								</span>
							{/if}
						</a>
					</li>
				{/each}
			</ul>
		</div>
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
		display: flex;
		align-items: center;
		min-height: 44px;
		font-weight: 600;
	}
	.group {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.group + .group {
		padding-top: 1rem;
		border-top: 1px solid var(--border-hairline);
	}
	.title {
		margin: 0;
		padding: 0 0.75rem;
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
	}
	.items {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		list-style: none;
		padding: 0;
		margin: 0;
	}
	.item {
		display: flex;
		align-items: center;
		gap: 0.625rem;
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
	.ico {
		flex: none;
		width: 1rem;
		text-align: center;
		color: var(--text-muted);
	}
	.item.active .ico {
		color: var(--text-primary);
	}
	.label {
		flex: 1;
		min-width: 0;
	}
	.count {
		flex: none;
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
	/* The footer controls are the only other things in here you can press,
	   so they get the same 44px hit area as a navigation item, in both
	   dimensions: "Esci" is four characters wide and would otherwise be a
	   26px target. */
	.foot :global(button) {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		min-width: 44px;
	}
</style>
