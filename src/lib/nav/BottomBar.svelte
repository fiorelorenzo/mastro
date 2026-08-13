<script lang="ts">
	// The phone chrome (#148, #233): the same five daily-loop-plus-ledger
	// destinations the sidebar leads with, a "More" sheet for the rest
	// (Inbox, Settings), and the one-tap record-a-day action the v0 promise
	// — a day logged in under thirty seconds, one-handed — depends on.
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import { appHref } from './href';
	import Badge from '$lib/design/Badge.svelte';
	import { BOTTOM_BAR_HREFS, NAV_GROUPS, isNavItemActive } from './items';

	let {
		pathname,
		counts
	}: {
		pathname: string;
		counts: { proposals: number; overdueInvoices: number };
	} = $props();

	const all = NAV_GROUPS.flatMap((group) => group.items);
	const bar = BOTTOM_BAR_HREFS.map((href) => all.find((item) => item.href === href)!);
	const rest = all.filter((item) => !BOTTOM_BAR_HREFS.includes(item.href));
	const restHasCount = rest.some((item) => item.badge && counts[item.badge] > 0);

	let sheet: HTMLDialogElement | undefined = $state();
</script>

<!-- Not rendered on /day/new itself: the page already is the record-a-day
     form, and at 390px the FAB's fixed bottom-right position sits directly
     over the Save button's keyboard hint (flagged during #233 review). -->
{#if pathname !== '/day/new'}
	<a href={resolve('/day/new')} class="fab" aria-label={m.nav_record_day()}>+</a>
{/if}

<nav class="bar" aria-label={m.nav_primary_label()}>
	{#each bar as item (item.href)}
		{@const active = isNavItemActive(item.href, pathname)}
		{@const count = item.badge ? counts[item.badge] : 0}
		<a
			href={appHref(item.href)}
			class="tab"
			class:active
			aria-current={active ? 'page' : undefined}
		>
			<span class="ico-wrap">
				<span class="ico" aria-hidden="true">{item.icon}</span>
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
			</span>
			{item.label()}
		</a>
	{/each}
	<button type="button" class="tab" onclick={() => sheet?.showModal()}>
		<span class="ico-wrap">
			<span class="ico" aria-hidden="true">⋯</span>
			{#if restHasCount}<span class="dot" aria-hidden="true"></span>{/if}
		</span>
		{m.nav_more()}
	</button>
</nav>

<dialog bind:this={sheet} class="sheet" onclick={() => sheet?.close()}>
	<ul>
		{#each rest as item (item.href)}
			{@const count = item.badge ? counts[item.badge] : 0}
			<li>
				<a href={appHref(item.href)} class="row">
					<span class="ico" aria-hidden="true">{item.icon}</span>
					<span class="label">{item.label()}</span>
					{#if count > 0}
						<Badge variant="count" size="sm" label={count > 99 ? '99+' : String(count)} />
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
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.125rem;
		min-height: 52px;
		font-size: 0.75rem;
		color: var(--text-secondary);
		border-top: 3px solid transparent;
		position: relative;
	}
	.tab.active {
		border-top-color: var(--text-primary);
		color: var(--text-primary);
		font-weight: 600;
	}
	.ico-wrap {
		position: relative;
		display: flex;
	}
	.tab .ico {
		font-size: 1.0625rem;
	}
	.tab .count {
		position: absolute;
		top: -0.375rem;
		right: -0.5rem;
	}
	.dot {
		position: absolute;
		top: -0.125rem;
		right: -0.25rem;
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 999px;
		background: var(--status-warning);
	}
	/* Mirrors the mockup's phone FAB: fixed above the tab bar, always
	   reachable with a thumb regardless of scroll position. */
	.fab {
		position: fixed;
		right: 1rem;
		bottom: calc(52px + env(safe-area-inset-bottom) + 0.75rem);
		width: 52px;
		height: 52px;
		border-radius: 999px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1.5rem;
		line-height: 1;
		background: var(--text-primary);
		color: var(--surface-page);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
	}
	.sheet {
		margin: auto auto 0 auto;
		width: 100%;
		border: 0;
		border-top: 1px solid var(--border-hairline);
		background: var(--surface-page);
		color: var(--text-primary);
	}
	.sheet ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		min-height: 48px;
		padding: 0 1rem;
	}
	.row .ico {
		flex: none;
		width: 1rem;
		text-align: center;
		color: var(--text-muted);
	}
	.row .label {
		flex: 1;
		min-width: 0;
	}
</style>
