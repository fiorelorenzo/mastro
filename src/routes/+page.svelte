<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import PageHeader from '$lib/nav/PageHeader.svelte';
	import CeilingMeter from '$lib/dashboard/CeilingMeter.svelte';
	import CashCalendarChart from '$lib/dashboard/CashCalendarChart.svelte';
	import ConcentrationChart from '$lib/dashboard/ConcentrationChart.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// The keyboard shortcut #24 asks for on desktop: "n" jumps straight
	// into the entry form from the home screen, skipping even the one tap.
	// Ignored while typing anywhere else on the page, so it never steals a
	// literal "n" from a text field.
	function onKeydown(event: KeyboardEvent) {
		const target = event.target as HTMLElement | null;
		const typing =
			target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;
		if (!typing && event.key === 'n' && !event.ctrlKey && !event.metaKey && !event.altKey) {
			event.preventDefault();
			goto(resolve('/day/new'));
		}
	}
</script>

<svelte:window onkeydown={onKeydown} />

<svelte:head><title>mastro</title></svelte:head>

<main class="page">
	<PageHeader title="mastro" subtitle={m.landing_tagline()} />

	<div class="mt-4 flex flex-wrap gap-3">
		<a href={resolve('/day/new')} class="record-day-cta">{m.home_record_day_cta()}</a>
		<a href={resolve('/proposals')} class="proposals-cta">
			{m.home_proposals_cta()}
			{#if data.pendingProposalsCount > 0}
				<span class="proposals-badge"
					>{m.home_proposals_pending_badge({ count: data.pendingProposalsCount })}</span
				>
			{/if}
		</a>
	</div>
	<p class="mt-2 text-xs opacity-60">{m.home_record_day_shortcut_hint()}</p>
	<p class="mt-3 text-sm">
		<a href={resolve('/day/calendar')} class="underline">{m.home_calendar_link()}</a>
	</p>

	<!-- #57 — the ceiling meter disappears entirely, not as an empty
	     widget, the moment there is no active whole-practice ceiling to
	     show (the generic pack, or a jurisdiction pack with none). -->
	{#if data.ceilings.length > 0}
		<section class="widget">
			<h2>{m.dashboard_ceiling_heading()}</h2>
			<div class="ceiling-grid">
				{#each data.ceilings as view (view.id)}
					<CeilingMeter {view} />
				{/each}
			</div>
		</section>
	{/if}

	<section class="widget">
		<h2>{m.dashboard_cash_calendar_heading()}</h2>
		<CashCalendarChart
			months={data.cashCalendar.months}
			to={data.cashCalendar.to}
			markers={data.cashCalendar.markers}
			assumptions={data.cashCalendar.assumptions}
		/>
	</section>

	<section class="widget">
		<h2>{m.dashboard_concentration_heading()}</h2>
		<ConcentrationChart
			byClient={data.concentration.byClient}
			total={data.concentration.total}
			shareCeilings={data.concentration.shareCeilings}
		/>
	</section>

	<footer class="account">
		<p class="text-sm">{m.signed_in_as({ email: data.user.email })}</p>
		<form method="POST" action="/sign-out">
			<button type="submit" class="text-sm underline">{m.sign_out()}</button>
		</form>
	</footer>
</main>

<style>
	.page {
		max-width: 60rem;
		margin: 0 auto;
		padding: 2rem 1.25rem 4rem;
		background: var(--surface-page);
		color: var(--text-primary);
	}
	.record-day-cta {
		display: inline-flex;
		align-items: center;
		border: 1px solid var(--text-primary);
		background: var(--text-primary);
		color: var(--surface-1);
		padding: 0.875rem 1.5rem;
		font-size: 1rem;
		font-weight: 600;
		text-decoration: none;
		min-height: 3rem;
	}
	.proposals-cta {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		border: 1px solid var(--text-primary);
		background: var(--surface-1);
		color: var(--text-primary);
		padding: 0.875rem 1.5rem;
		font-size: 1rem;
		font-weight: 600;
		text-decoration: none;
		min-height: 3rem;
	}
	.proposals-badge {
		display: inline-flex;
		align-items: center;
		border-radius: 999px;
		background: var(--status-warning);
		color: var(--text-primary);
		padding: 0.125rem 0.5rem;
		font-size: 0.75rem;
		font-weight: 600;
	}
	.widget {
		margin-bottom: 2.5rem;
	}
	.widget h2 {
		margin: 0 0 0.875rem;
		font-size: 1.0625rem;
		font-weight: 600;
		color: var(--text-primary);
	}
	.ceiling-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
		gap: 1rem;
	}
	.account {
		margin-top: 3rem;
		padding-top: 1.5rem;
		border-top: 1px solid var(--border-hairline);
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
</style>
