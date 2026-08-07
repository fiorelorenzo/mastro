<script lang="ts">
	import * as m from '$lib/paraglide/messages';
</script>

<svelte:head><title>{m.offline_page_title()}</title></svelte:head>

<main class="mx-auto max-w-2xl p-8">
	<h1 class="text-2xl font-semibold">{m.offline_page_heading()}</h1>
	<p class="mt-2 text-sm opacity-70">{m.offline_page_body()}</p>
	<button
		type="button"
		class="mt-6 rounded bg-black px-3 py-1.5 text-sm font-medium text-white dark:bg-white dark:text-black"
		onclick={() => location.reload()}
	>
		{m.offline_page_retry()}
	</button>
</main>
