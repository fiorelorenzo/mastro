<!--
	The install affordance (#231): a floating prompt for Android/desktop
	Chrome's native `beforeinstallprompt` flow (`installPrompt.
	showAndroidPrompt`), and a manual "tap Share, then Add to Home Screen"
	hint for iOS Safari, which never fires that event (`installPrompt.
	showIosHint`). Every string here used to be hardcoded English — in a
	product where a missing message key fails the build precisely so a
	component can never ship untranslated, this was the one place that
	rule did not reach.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import * as m from '$lib/paraglide/messages';
	import { Button } from '$lib/design';
	import { installPrompt } from './install.svelte';

	onMount(() => installPrompt.init());
</script>

{#if installPrompt.showAndroidPrompt}
	<div role="status" class="prompt">
		<p>{m.install_prompt_android_message()}</p>
		<div class="actions">
			<Button variant="primary" size="sm" onclick={() => installPrompt.promptInstall()}>
				{m.install_prompt_install_button()}
			</Button>
			<Button variant="tertiary" size="sm" onclick={() => installPrompt.dismissAndroid()}>
				{m.install_prompt_dismiss_button()}
			</Button>
		</div>
	</div>
{:else if installPrompt.showIosHint}
	<div role="status" class="prompt">
		<p>{m.install_prompt_ios_message()}</p>
		<div class="actions">
			<Button variant="tertiary" size="sm" onclick={() => installPrompt.hideIosHint()}>
				{m.install_prompt_ios_dismiss_button()}
			</Button>
		</div>
	</div>
{/if}

<style>
	.prompt {
		position: fixed;
		z-index: 50;
		inset-inline: var(--space-4);
		bottom: var(--space-4);
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-md);
		background: var(--surface-overlay);
		box-shadow: var(--shadow-overlay);
		padding: var(--space-4);
		font-size: var(--text-sm);
		color: var(--text-primary);
	}
	.actions {
		display: flex;
		flex: none;
		gap: var(--space-2);
	}
</style>
