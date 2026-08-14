<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import * as m from '$lib/paraglide/messages';
	import Page from '$lib/layout/Page.svelte';
	import { pushSubscriptionStore } from '$lib/pwa/push.svelte';
	import type { AlertType } from '$lib/server/db/schema/alert';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	onMount(() => {
		pushSubscriptionStore.init();
	});

	function alertTypeLabel(type: AlertType): string {
		switch (type) {
			case 'contract_expiring':
				return m.alerts_type_contract_expiring();
			case 'renewal_window_open':
				return m.alerts_type_renewal_window_open();
			case 'worked_without_approval':
				return m.alerts_type_worked_without_approval();
			case 'approval_unactioned':
				return m.alerts_type_approval_unactioned();
			case 'invoice_overdue':
				return m.alerts_type_invoice_overdue();
			case 'billable_period_closed':
				return m.alerts_type_billable_period_closed();
			case 'ceiling_approaching':
				return m.alerts_type_ceiling_approaching();
			case 'year_end_overrun_risk':
				return m.alerts_type_year_end_overrun_risk();
			case 'backup_failure':
				return m.alerts_type_backup_failure();
			case 'mirror_failure':
				return m.alerts_type_mirror_failure();
			case 'mailbox_poll_failure':
				return m.alerts_type_mailbox_poll_failure();
			case 'agent_run_failure':
				return m.alerts_type_agent_run_failure();
			case 'proposal_pending':
				return m.alerts_type_proposal_pending();
		}
	}

	async function enablePush() {
		if (data.vapidPublicKey) await pushSubscriptionStore.subscribe(data.vapidPublicKey);
	}
</script>

<svelte:head><title>{m.alerts_settings_page_title()}</title></svelte:head>

<Page crumbs={data.crumbs} title={m.alerts_settings_heading()}>
	<p class="mt-2 text-sm opacity-70">{m.alerts_settings_intro()}</p>

	<section class="mt-8">
		<h2 class="text-lg font-semibold">{m.alerts_settings_push_heading()}</h2>
		<p class="mt-1 text-sm opacity-70">{m.alerts_settings_push_intro()}</p>

		{#if !data.vapidPublicKey}
			<p class="mt-3 text-sm opacity-70">{m.alerts_settings_push_not_configured()}</p>
		{:else if pushSubscriptionStore.status === 'unsupported'}
			<p class="mt-3 text-sm opacity-70">{m.alerts_settings_push_unsupported()}</p>
		{:else if pushSubscriptionStore.status === 'ios-needs-install'}
			<p class="mt-3 text-sm opacity-70">{m.alerts_settings_push_ios_hint()}</p>
		{:else if pushSubscriptionStore.subscribed}
			<p class="mt-3 text-sm">{m.alerts_settings_push_subscribed_status()}</p>
			<button
				type="button"
				class="mt-2 border px-3 py-1.5 text-sm"
				disabled={pushSubscriptionStore.busy}
				onclick={() => pushSubscriptionStore.unsubscribe()}
			>
				{m.alerts_settings_push_disable_button()}
			</button>
		{:else}
			<p class="mt-3 text-sm opacity-70">{m.alerts_settings_push_not_subscribed_status()}</p>
			<button
				type="button"
				class="mt-2 border px-3 py-1.5 text-sm"
				disabled={pushSubscriptionStore.busy}
				onclick={enablePush}
			>
				{m.alerts_settings_push_enable_button()}
			</button>
			{#if pushSubscriptionStore.permissionDenied}
				<p class="mt-2 text-sm opacity-70">{m.alerts_settings_push_permission_denied()}</p>
			{/if}
		{/if}
	</section>

	<section class="mt-8">
		<h2 class="text-lg font-semibold">{m.alerts_settings_preferences_heading()}</h2>
		<form method="POST" action="?/savePreferences" use:enhance class="mt-3">
			<table class="w-full border-collapse text-sm">
				<thead>
					<tr class="border-b text-left">
						<th class="py-2 pr-4">{m.alerts_settings_preferences_type_column()}</th>
						<th class="py-2 pr-4">{m.alerts_settings_preferences_digest_column()}</th>
						<th class="py-2 pr-4">{m.alerts_settings_preferences_push_column()}</th>
					</tr>
				</thead>
				<tbody>
					{#each data.preferences as preference (preference.type)}
						<tr class="border-b">
							<td class="py-2 pr-4">{alertTypeLabel(preference.type)}</td>
							<td class="py-2 pr-4">
								<input
									type="checkbox"
									name="digest_{preference.type}"
									checked={preference.digestEnabled}
								/>
							</td>
							<td class="py-2 pr-4">
								<input
									type="checkbox"
									name="push_{preference.type}"
									checked={preference.pushEnabled}
								/>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
			<button type="submit" class="mt-4 border px-4 py-2 text-sm">
				{m.alerts_settings_preferences_save_button()}
			</button>
		</form>
	</section>
</Page>
