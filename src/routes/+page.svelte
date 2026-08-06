<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head><title>mastro</title></svelte:head>

<main class="mx-auto max-w-2xl p-8">
	<h1 class="text-2xl font-semibold">mastro</h1>
	<p class="mt-2 text-sm opacity-70">
		{m.landing_tagline()}
	</p>
	<p class="mt-6 text-sm">{m.signed_in_as({ email: data.user.email })}</p>
	<form method="POST" action="/sign-out">
		<button type="submit" class="mt-2 text-sm underline">{m.sign_out()}</button>
	</form>
</main>
