<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import { getLocale } from '$lib/paraglide/runtime';
	import { formatDate } from '$lib/i18n/format';
	import LanguageSwitch from '$lib/components/LanguageSwitch.svelte';
	import Page from '$lib/layout/Page.svelte';
	import { SegmentedControl } from '$lib/design';
	import { theme } from '$lib/theme.svelte';
	import type { ThemePreference } from '$lib/theme';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const locale = $derived(getLocale());

	const themeOptions = $derived([
		{ value: 'system', label: m.theme_option_system() },
		{ value: 'light', label: m.theme_option_light() },
		{ value: 'dark', label: m.theme_option_dark() }
	]);

	// SegmentedControl binds a plain `string`; narrow back to the branded
	// preference type on write, `theme.ts`'s own default protects against
	// anything else ever reaching the store.
	let themePreference = $state<string>(theme.preference);
	$effect(() => theme.set(themePreference as ThemePreference));
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
		<a href={resolve('/settings/fiscal')} class="mt-2 inline-block text-sm underline"
			>{m.settings_fiscal_manage_link()}</a
		>
	</section>

	<section class="mt-8">
		<h2 class="text-lg font-medium">{m.settings_language_heading()}</h2>
		<div class="mt-2">
			<LanguageSwitch />
		</div>
	</section>

	<section class="mt-8">
		<h2 class="text-lg font-medium">{m.settings_appearance_heading()}</h2>
		<div class="mt-2">
			<SegmentedControl
				label={m.theme_switch_label()}
				options={themeOptions}
				bind:value={themePreference}
			/>
		</div>
	</section>

	<section class="mt-8">
		<h2 class="text-lg font-medium">{m.settings_alerts_heading()}</h2>
		<a href={resolve('/alerts/settings')} class="mt-2 inline-block text-sm underline"
			>{m.settings_alerts_link()}</a
		>
	</section>
</Page>
