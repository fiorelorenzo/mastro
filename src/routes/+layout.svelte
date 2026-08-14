<script lang="ts">
	import './layout.css';
	import { page } from '$app/state';
	import favicon from '$lib/assets/favicon.svg';
	import Sidebar from '$lib/nav/Sidebar.svelte';
	import BottomBar from '$lib/nav/BottomBar.svelte';
	import InstallPrompt from '$lib/pwa/InstallPrompt.svelte';
	import OfflineQueueIndicator from '$lib/pwa/OfflineQueueIndicator.svelte';
	import OfflineDataBanner from '$lib/pwa/OfflineDataBanner.svelte';
	import Toast from '$lib/design/Toast.svelte';
	import { SURFACE_DARK, SURFACE_LIGHT } from '$lib/pwa/colors';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();

	// No chrome where there is nothing to navigate to: the sign-in page and
	// the offline fallback are both public and both dead ends by design.
	const chrome = $derived(data.user !== null);
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
<OfflineDataBanner />
{#if chrome}
	<div class="shell">
		<div class="rail">
			<Sidebar pathname={page.url.pathname} counts={data.counts} user={data.user} />
		</div>
		<div class="content">{@render children()}</div>
	</div>
	<div class="tabs">
		<BottomBar pathname={page.url.pathname} counts={data.counts} />
	</div>
	<OfflineQueueIndicator />
{:else}
	{@render children()}
{/if}
<InstallPrompt />
<Toast />

<style>
	.shell {
		display: flex;
		align-items: flex-start;
	}
	.rail {
		position: sticky;
		top: 0;
	}
	.content {
		flex: 1;
		min-width: 0;
		max-width: 1100px;
		padding-bottom: 72px; /* clears the bottom bar */
	}
	.tabs {
		display: block;
	}
	@media (max-width: 899px) {
		.rail {
			display: none;
		}
	}
	@media (min-width: 900px) {
		.tabs {
			display: none;
		}
		.content {
			padding-bottom: 0;
		}
	}
</style>
