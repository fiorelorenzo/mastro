<script lang="ts">
	import { onMount } from 'svelte';
	import { installPrompt } from './install.svelte';

	onMount(() => installPrompt.init());
</script>

{#if installPrompt.showAndroidPrompt}
	<div
		role="status"
		class="fixed inset-x-4 bottom-4 z-50 flex items-center justify-between gap-4 rounded-lg
			border border-black/10 bg-white p-4 text-sm shadow-lg dark:border-white/10
			dark:bg-neutral-900"
	>
		<p>Install mastro for quick access from your home screen.</p>
		<div class="flex shrink-0 gap-2">
			<button
				type="button"
				class="rounded bg-black px-3 py-1.5 font-medium text-white dark:bg-white dark:text-black"
				onclick={() => installPrompt.promptInstall()}
			>
				Install
			</button>
			<button
				type="button"
				class="rounded px-3 py-1.5 opacity-70"
				onclick={() => installPrompt.dismissAndroid()}
			>
				Not now
			</button>
		</div>
	</div>
{:else if installPrompt.showIosHint}
	<div
		role="status"
		class="fixed inset-x-4 bottom-4 z-50 flex items-center justify-between gap-4 rounded-lg
			border border-black/10 bg-white p-4 text-sm shadow-lg dark:border-white/10
			dark:bg-neutral-900"
	>
		<p>
			Add mastro to your home screen: tap <strong>Share</strong>, then
			<strong>Add to Home Screen</strong>.
		</p>
		<button
			type="button"
			class="shrink-0 rounded px-3 py-1.5 opacity-70"
			onclick={() => installPrompt.hideIosHint()}
		>
			Got it
		</button>
	</div>
{/if}
