<script lang="ts">
	// #227: this page is the one document `service-worker.ts` ever serves
	// from Cache Storage (see `isOfflineDocumentRequest` there) — stateless
	// and public (`route-guard.ts`) by design, so it is safe to precache
	// and hand to anyone. That is also exactly why it cannot itself *be*
	// the day-entry form: it never reads `locals.user` and carries no
	// contract data. What it can do, once hydrated, is a normal SvelteKit
	// client-side navigation — `goto()` — which fetches the target route's
	// data the same way clicking a link would. If that route's data was
	// ever warmed into DATA_CACHE (a previous visit, or the proactive
	// warm-up `install` does for /day/new specifically — see
	// `warmDayEntryData` in service-worker.ts), `handleDataRequest`
	// answers it with zero network, and the *real* target page renders,
	// no reimplementation of it needed here.
	//
	// `?to=` is `offlineFallbackUrl`'s doing: the service worker's own
	// navigation fallback carries the URL that actually failed, so a
	// direct, cold, offline visit to e.g. /day/new lands here and then
	// continues on to /day/new automatically, without the visitor ever
	// having to know this page existed. A cold open with no `to` at all
	// (the manifest's start_url, or `/offline` visited directly) falls
	// through to the explicit "Record a day" action below instead.
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import * as m from '$lib/paraglide/messages';
	import { Button } from '$lib/design';

	let recordDayUnavailable = $state(false);

	function safeRedirectTarget(value: string | null): string | null {
		if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('://')) {
			return null;
		}
		return value === resolve('/offline') ? null : value;
	}

	onMount(() => {
		const target = safeRedirectTarget(page.url.searchParams.get('to'));
		// `safeRedirectTarget` only ever returns a path it validated against
		// the app's own routes, and the rule recognises a literal `resolve()`
		// in the argument rather than a value that already went through one.
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		if (target) void goto(target).catch(() => {});
	});

	async function recordDay() {
		recordDayUnavailable = false;
		try {
			await goto(resolve('/day/new'));
		} catch {
			recordDayUnavailable = true;
		}
	}
</script>

<svelte:head><title>{m.offline_page_title()}</title></svelte:head>

<main class="mx-auto max-w-2xl p-8">
	<h1 class="text-2xl font-semibold">{m.offline_page_heading()}</h1>
	<p class="mt-2 text-sm opacity-70">{m.offline_page_body()}</p>
	<div class="mt-6 flex flex-wrap gap-3">
		<Button variant="primary" onclick={recordDay}>{m.nav_record_day()}</Button>
		<Button variant="secondary" onclick={() => location.reload()}>{m.offline_page_retry()}</Button>
	</div>
	{#if recordDayUnavailable}
		<p class="mt-3 text-sm opacity-70">{m.offline_page_record_day_unavailable()}</p>
	{/if}
</main>
