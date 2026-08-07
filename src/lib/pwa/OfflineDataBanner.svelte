<script lang="ts">
	import { onMount } from 'svelte';
	import * as m from '$lib/paraglide/messages';
	import { formatDateTime } from '$lib/i18n/format';
	import { StatusIndicator } from '$lib/design';
	import { swClient } from './sw-client.svelte';

	onMount(() => swClient.init());
</script>

<!--
	Rendered whenever the data currently on screen came from Cache Storage
	and no network round trip has confirmed it current yet — this is the
	"a stale response is visibly marked as stale" requirement from #61,
	applied at the shell level rather than inline per figure, because no
	page this wave owns a widget to attach the label to directly (see the
	PR description). A future dashboard reading the same
	`mastro:data-stale` / `mastro:data-fresh` messages (or the
	`x-mastro-cached-at` header the service worker tags cached responses
	with) can label a specific number instead.

	Deliberately NOT gated on `navigator.onLine`: that flag only reports
	whether the device has a network interface up, not whether this
	instance is reachable — a self-hosted server that is down, or a
	network that reaches everywhere except this one host, leaves
	`navigator.onLine` `true` while every revalidation still fails. The
	service worker's own stale/fresh messages are the ground truth this
	banner reacts to; `swClient.offline` only picks which sentence to
	show, "offline" or an unreached instance.
-->
{#if swClient.oldestStaleAt}
	<div role="status" class="banner">
		<StatusIndicator
			level="warning"
			label={swClient.offline
				? m.data_freshness_banner_offline_label({ time: formatDateTime(swClient.oldestStaleAt) })
				: m.data_freshness_banner_unreachable_label({
						time: formatDateTime(swClient.oldestStaleAt)
					})}
		/>
	</div>
{/if}

<style>
	.banner {
		border-bottom: 1px solid var(--border-hairline);
		background: var(--surface-1);
		padding: 0.5rem 1rem;
	}
</style>
