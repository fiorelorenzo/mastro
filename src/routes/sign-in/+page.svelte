<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import LanguageSwitch from '$lib/components/LanguageSwitch.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head><title>{m.sign_in_title()}</title></svelte:head>

<main class="mx-auto flex min-h-[80svh] max-w-md flex-col justify-center gap-6 p-6">
	<div class="flex flex-col gap-2">
		<h1 class="text-2xl font-semibold">mastro</h1>
		<p class="text-sm opacity-70">{m.landing_tagline()}</p>
	</div>

	{#if data.rejected}
		<!-- Deliberately the same message whatever the reason: it must not
		     say whether an address is known to this instance (#53). -->
		<p
			class="border-l-2 py-2 pl-3 text-sm font-semibold"
			style="border-color: var(--color-status-critical)"
			role="alert"
		>
			{m.sign_in_rejected()}
		</p>
	{/if}

	<!-- A link, not a form POST. Starting an OAuth flow is a navigation, and
	     a GET keeps it bookmarkable and outside SvelteKit's CSRF origin
	     check, which is one fewer thing to get wrong behind a reverse proxy
	     (the app still sets ORIGIN in production for every real form). -->
	<div>
		<a
			href="/sign-in/google?callbackURL={encodeURIComponent(data.callbackURL)}"
			data-sveltekit-reload
			class="flex min-h-[44px] w-full items-center justify-center gap-3 border px-4 py-3 text-sm font-semibold"
		>
			<svg aria-hidden="true" viewBox="0 0 18 18" class="h-5 w-5">
				<path
					fill="#4285F4"
					d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62Z"
				/>
				<path
					fill="#34A853"
					d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.35 0-4.34-1.58-5.05-3.71H.96v2.33A9 9 0 0 0 9 18Z"
				/>
				<path
					fill="#FBBC05"
					d="M3.95 10.71a5.41 5.41 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l2.99-2.33Z"
				/>
				<path
					fill="#EA4335"
					d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l2.99 2.33C4.66 5.16 6.65 3.58 9 3.58Z"
				/>
			</svg>
			{m.sign_in_with_google()}
		</a>
	</div>

	<p class="text-xs opacity-70">{m.sign_in_allowlist_note()}</p>

	<div class="pt-2"><LanguageSwitch /></div>
</main>
