<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import LanguageSwitch from '$lib/components/LanguageSwitch.svelte';

	let { children } = $props();
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
<div class="flex justify-end p-4">
	<LanguageSwitch />
</div>
{@render children()}
