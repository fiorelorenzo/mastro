<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import LanguageSwitch from '$lib/components/LanguageSwitch.svelte';
	import InstallPrompt from '$lib/pwa/InstallPrompt.svelte';
	import { SURFACE_DARK, SURFACE_LIGHT } from '$lib/pwa/colors';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<link rel="manifest" href="/manifest.webmanifest" />
	<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
	<meta name="theme-color" media="(prefers-color-scheme: light)" content={SURFACE_LIGHT} />
	<meta name="theme-color" media="(prefers-color-scheme: dark)" content={SURFACE_DARK} />
	<!-- iOS ignores display: standalone in the manifest on its own; this is what
	     actually makes "Add to Home Screen" launch without browser chrome. -->
	<meta name="apple-mobile-web-app-capable" content="yes" />
	<meta name="mobile-web-app-capable" content="yes" />
	<meta name="apple-mobile-web-app-status-bar-style" content="default" />
	<!-- iOS ignores short_name too, and shows this under the home screen icon instead. -->
	<meta name="apple-mobile-web-app-title" content="mastro" />
</svelte:head>
<div class="flex justify-end p-4">
	<LanguageSwitch />
</div>
{@render children()}
<InstallPrompt />
