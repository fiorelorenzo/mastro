<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
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

<main class="mx-auto max-w-2xl p-8">
	<h1 class="text-2xl font-semibold">mastro</h1>
	<p class="mt-2 text-sm opacity-70">
		{m.landing_tagline()}
	</p>

	<div class="mt-6 flex items-center gap-4">
		<a href={resolve('/day/new')} class="record-day-cta">{m.home_record_day_cta()}</a>
		<span class="text-xs opacity-60">{m.home_record_day_shortcut_hint()}</span>
	</div>
	<p class="mt-3 text-sm">
		<a href={resolve('/day/calendar')} class="underline">{m.home_calendar_link()}</a>
	</p>

	<p class="mt-8 text-sm">{m.signed_in_as({ email: data.user.email })}</p>
	<form method="POST" action="/sign-out">
		<button type="submit" class="mt-2 text-sm underline">{m.sign_out()}</button>
	</form>
</main>

<style>
	.record-day-cta {
		display: inline-block;
		border: 1px solid var(--text-primary, #0b0b0b);
		background: var(--text-primary, #0b0b0b);
		color: var(--surface-1, #fcfcfb);
		padding: 0.875rem 1.5rem;
		font-size: 1rem;
		font-weight: 600;
		text-decoration: none;
		min-height: 3rem;
		display: inline-flex;
		align-items: center;
	}
</style>
