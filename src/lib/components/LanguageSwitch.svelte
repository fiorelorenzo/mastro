<script lang="ts">
	import { getLocale, locales, setLocale, type Locale } from '$lib/paraglide/runtime';
	import * as m from '$lib/paraglide/messages';

	// Each language names itself; that is never translated, the same way a
	// legal string never is (AGENTS.md invariant 5). `Intl.DisplayNames` gives
	// the autonym without hand-rolling a lookup table.
	function autonym(locale: Locale): string {
		return new Intl.DisplayNames([locale], { type: 'language' }).of(locale) ?? locale;
	}
</script>

<div role="group" aria-label={m.language_switch_label()} class="flex gap-2 text-sm">
	{#each locales as locale (locale)}
		<button
			type="button"
			aria-pressed={getLocale() === locale}
			disabled={getLocale() === locale}
			onclick={() => setLocale(locale)}
			class="underline decoration-dotted underline-offset-2 disabled:no-underline disabled:opacity-50"
		>
			{autonym(locale)}
		</button>
	{/each}
</div>
