<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import { formatDateTime } from '$lib/i18n/format';
	import { StatusIndicator, type StatusLevel } from '$lib/design';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	function severityLabel(severity: StatusLevel): string {
		if (severity === 'critical') return m.alerts_severity_critical();
		if (severity === 'serious') return m.alerts_severity_serious();
		return m.alerts_severity_warning();
	}
</script>

<svelte:head><title>{m.alerts_page_title()}</title></svelte:head>

<main class="mx-auto max-w-3xl p-8">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-semibold">{m.alerts_page_heading()}</h1>
		<a href={resolve('/alerts/settings')} class="text-sm underline"
			>{m.alerts_page_settings_link()}</a
		>
	</div>

	{#if data.alerts.length === 0}
		<p class="mt-4 text-sm opacity-70">{m.alerts_page_empty()}</p>
	{:else}
		<ul class="mt-4 flex flex-col gap-4">
			{#each data.alerts as alert (alert.key)}
				<li class="border p-4">
					<div class="flex items-start justify-between gap-4">
						<div>
							<StatusIndicator level={alert.severity} label={severityLabel(alert.severity)} />
							<p class="mt-1 font-medium">{alert.title}</p>
							<p class="text-sm opacity-70">{alert.body}</p>
							{#if alert.acknowledged}
								<p class="mt-1 text-xs opacity-70">
									{m.alerts_page_acknowledged_by({
										by: alert.acknowledgedBy ?? '',
										at: alert.acknowledgedAt ? formatDateTime(alert.acknowledgedAt) : ''
									})}
								</p>
							{/if}
						</div>
						{#if !alert.acknowledged}
							<form method="POST" action="?/acknowledge" use:enhance class="shrink-0">
								<input type="hidden" name="key" value={alert.key} />
								<button type="submit" class="border px-3 py-1.5 text-sm">
									{m.alerts_page_acknowledge_button()}
								</button>
							</form>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</main>
