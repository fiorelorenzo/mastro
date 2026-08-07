<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import { getLocale } from '$lib/paraglide/runtime';
	import { formatDate } from '$lib/i18n/format';
	import LanguageSwitch from '$lib/components/LanguageSwitch.svelte';
	import Page from '$lib/layout/Page.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const locale = $derived(getLocale());
</script>

<svelte:head><title>{m.settings_page_title()}</title></svelte:head>

<Page title={m.settings_heading()}>
	<section class="mt-8">
		<h2 class="text-lg font-medium">{m.settings_fiscal_heading()}</h2>
		{#if data.fiscalProfile}
			<p class="mt-2 text-sm">
				{m.settings_fiscal_active({
					pack: data.fiscalProfile.displayName[locale],
					date: formatDate(data.fiscalProfile.validFrom, locale)
				})}
			</p>
		{:else}
			<p class="mt-2 text-sm opacity-70">{m.settings_fiscal_none()}</p>
		{/if}
		<p class="mt-2 text-sm opacity-70">{m.settings_fiscal_configured_note()}</p>
	</section>

	<section class="mt-8">
		<h2 class="text-lg font-medium">{m.settings_language_heading()}</h2>
		<div class="mt-2">
			<LanguageSwitch />
		</div>
	</section>

	<section class="mt-8">
		<h2 class="text-lg font-medium">{m.settings_alerts_heading()}</h2>
		<a href={resolve('/alerts/settings')} class="mt-2 inline-block text-sm underline"
			>{m.settings_alerts_link()}</a
		>
	</section>
</Page>
