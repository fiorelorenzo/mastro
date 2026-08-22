<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { Button, Checkbox } from '$lib/design';
	import * as m from '$lib/paraglide/messages';
	import Page from '$lib/layout/Page.svelte';
	import Section from '$lib/layout/Section.svelte';
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
			case 'recorded_day_contradicted':
				return m.alerts_type_recorded_day_contradicted();
			case 'pending_proposal_unconfirmed':
				return m.alerts_type_pending_proposal_unconfirmed();
		}
	}

	async function enablePush() {
		if (data.vapidPublicKey) await pushSubscriptionStore.subscribe(data.vapidPublicKey);
	}

	// `use:enhance` (pre-existing here), never `submitting()`: the default
	// action updates the table in place rather than navigating away, so
	// nothing ever remounts this component to reset a `busy` flag the way
	// `submitting()` assumes.
	let saving = $state(false);
	const onSave: SubmitFunction = () => {
		saving = true;
		return async ({ update }) => {
			await update();
			saving = false;
		};
	};
</script>

<svelte:head><title>{m.alerts_settings_page_title()}</title></svelte:head>

<Page crumbs={data.crumbs} title={m.alerts_settings_heading()}>
	<p class="intro">{m.alerts_settings_intro()}</p>

	<Section title={m.alerts_settings_push_heading()}>
		<p class="muted">{m.alerts_settings_push_intro()}</p>

		{#if !data.vapidPublicKey}
			<p class="muted">{m.alerts_settings_push_not_configured()}</p>
		{:else if pushSubscriptionStore.status === 'unsupported'}
			<p class="muted">{m.alerts_settings_push_unsupported()}</p>
		{:else if pushSubscriptionStore.status === 'ios-needs-install'}
			<p class="muted">{m.alerts_settings_push_ios_hint()}</p>
		{:else if pushSubscriptionStore.subscribed}
			<p class="status">{m.alerts_settings_push_subscribed_status()}</p>
			<Button
				variant="secondary"
				size="sm"
				disabled={pushSubscriptionStore.busy}
				onclick={() => pushSubscriptionStore.unsubscribe()}
			>
				{m.alerts_settings_push_disable_button()}
			</Button>
		{:else}
			<p class="muted">{m.alerts_settings_push_not_subscribed_status()}</p>
			<Button
				variant="secondary"
				size="sm"
				disabled={pushSubscriptionStore.busy}
				onclick={enablePush}
			>
				{m.alerts_settings_push_enable_button()}
			</Button>
			{#if pushSubscriptionStore.permissionDenied}
				<p class="muted">{m.alerts_settings_push_permission_denied()}</p>
			{/if}
		{/if}
	</Section>

	<Section title={m.alerts_settings_preferences_heading()}>
		<form method="POST" action="?/savePreferences" use:enhance={onSave}>
			<!--
				#387. Two things changed here and one deliberately did not.

				The boxes are `Checkbox` now, and their labels are the accessible
				name only: printed, they repeated "Weekly email" and "Push" once
				per row beside columns that already said it. The name is built
				per row rather than per column, because a screen reader announces
				the cell it is on, so "Weekly email for Invoice overdue" is
				useful where thirteen identical "Weekly email" are not.

				The table stays hand-built, and `Table` is the wrong component
				for it: `Table` renders the desktop table *and* the mobile card
				list into the DOM together and switches with CSS, so every
				control inside it exists twice under one `name`. Measured on
				this page while converting it - unticking the visible box left
				the hidden copy checked and `new FormData(form)` still yielded
				`["on"]`, so the preference could never be turned off. That
				duality is right for rows you read and wrong for rows you edit.
			-->
			<table>
				<thead>
					<tr>
						<th scope="col">{m.alerts_settings_preferences_type_column()}</th>
						<th scope="col">{m.alerts_settings_preferences_digest_column()}</th>
						<th scope="col">{m.alerts_settings_preferences_push_column()}</th>
					</tr>
				</thead>
				<tbody>
					{#each data.preferences as preference (preference.type)}
						<tr>
							<th scope="row">{alertTypeLabel(preference.type)}</th>
							<td>
								<Checkbox
									name="digest_{preference.type}"
									checked={preference.digestEnabled}
									labelHidden
									label={m.alerts_settings_preferences_digest_for_type({
										type: alertTypeLabel(preference.type)
									})}
								/>
							</td>
							<td>
								<Checkbox
									name="push_{preference.type}"
									checked={preference.pushEnabled}
									labelHidden
									label={m.alerts_settings_preferences_push_for_type({
										type: alertTypeLabel(preference.type)
									})}
								/>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
			<Button type="submit" variant="primary" size="md" loading={saving}>
				{m.alerts_settings_preferences_save_button()}
			</Button>
		</form>
	</Section>
</Page>

<style>
	/* #387: the page used to carry utility classes for its own type scale,
	   which is how it came to look like a different product from the screens
	   around it. Tokens, like everywhere else. */
	.intro,
	.muted {
		font-size: var(--text-sm);
		color: var(--text-muted);
		margin: var(--space-2) 0 0;
	}
	.status {
		font-size: var(--text-sm);
		margin: var(--space-2) 0 var(--space-2);
	}
	.intro {
		margin-bottom: var(--space-6);
	}
	/* The same table chrome Table.svelte draws, minus the card duality that
	   makes it unusable for a row you edit (see the comment in the markup). */
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--text-sm);
	}
	th,
	td {
		padding: var(--space-2) var(--space-4) var(--space-2) 0;
		text-align: start;
		border-bottom: 1px solid var(--border-subtle);
	}
	thead th {
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	tbody th {
		font-weight: var(--weight-regular);
	}
	form :global(button[type='submit']) {
		margin-top: var(--space-4);
	}
</style>
