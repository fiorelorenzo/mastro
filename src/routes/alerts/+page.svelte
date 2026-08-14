<!--
	The alert feed (#220): every row deep-links to its subject and carries
	the action that resolves it — the fix for the sharpest defect the UX
	audit found ("gli avvisi non si possono agire"): the old page rendered
	title/body and threw every id `alerts/types.ts` carries away, leaving
	"Conferma presa visione" (a severity-rank silencer) as the only verb.
	`alerts/actions.ts`'s `alertResolution` supplies the link/action pair
	per alert kind, computed server-side in `+page.server.ts` so this file
	stays presentation only. Severity is a rail (`box-shadow: inset`, the
	mockup's own `.att--critical`) plus a `Badge`, replacing the 14px
	`StatusIndicator` glyph the audit flagged as too light for the one
	thing on this page that triages it. Acknowledge is demoted to a
	tertiary `Button` — it stays, but it is no longer the only verb.
-->
<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import { formatDateTime } from '$lib/i18n/format';
	import Badge from '$lib/design/Badge.svelte';
	import Button from '$lib/design/Button.svelte';
	import Dialog from '$lib/design/Dialog.svelte';
	import Field from '$lib/design/Field.svelte';
	import Textarea from '$lib/design/Textarea.svelte';
	import { toasts } from '$lib/design/toast-store.svelte';
	import Page from '$lib/layout/Page.svelte';
	import type { AlertSeverity } from '$lib/server/db/schema/alert';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	function severityLabel(severity: AlertSeverity): string {
		if (severity === 'critical') return m.alerts_severity_critical();
		if (severity === 'serious') return m.alerts_severity_serious();
		return m.alerts_severity_warning();
	}

	// #228's other exit from the risk state, offered right here as a
	// Dialog-confirmed form action — never a bare click, since it is
	// one-way. Only one row's dialog is ever open at a time, so a single
	// key (rather than one flag per alert) is enough; `alerts_unbillable_
	// reason_required` on a failed submit reopens the same row instead of
	// silently discarding what was typed.
	let openUnbillableFor = $state<string | null>(
		form?.unbillableError ? (form.workUnitId ?? null) : null
	);
	let unbillableReason = $state(form?.reason ?? '');
	let announcedUnbillableFor: string | null = null;
	$effect(() => {
		if (!form?.markedUnbillable || !form.workUnitId) return;
		if (announcedUnbillableFor === form.workUnitId) return;
		announcedUnbillableFor = form.workUnitId;
		toasts.push('neutral', m.alerts_unbillable_toast());
	});
</script>

<svelte:head><title>{m.alerts_page_title()}</title></svelte:head>

<Page title={m.alerts_page_heading()}>
	{#snippet actions()}
		<a href={resolve('/alerts/settings')} class="text-sm underline"
			>{m.alerts_page_settings_link()}</a
		>
	{/snippet}

	{#if data.alerts.length === 0}
		<p class="mt-4 text-sm opacity-70">{m.alerts_page_empty()}</p>
	{:else}
		<ul class="alert-list">
			{#each data.alerts as alert (alert.key)}
				<li class="alert severity-{alert.severity}">
					<div class="alert-body">
						<Badge variant={alert.severity} label={severityLabel(alert.severity)} size="sm" />
						<p class="alert-title">{alert.title}</p>
						<p class="alert-detail">{alert.body}</p>
						{#if alert.acknowledged}
							<p class="alert-ack">
								{m.alerts_page_acknowledged_by({
									by: alert.acknowledgedBy ?? '',
									at: alert.acknowledgedAt ? formatDateTime(alert.acknowledgedAt) : ''
								})}
							</p>
						{/if}
						<div class="alert-actions">
							<Button href={alert.actionHref} variant="primary" size="sm">
								{alert.actionLabel}
							</Button>
							{#if alert.subjectHref !== alert.actionHref}
								<Button href={alert.subjectHref} variant="secondary" size="sm">
									{alert.subjectLabel}
								</Button>
							{/if}
							{#if !alert.acknowledged}
								<form method="POST" action="?/acknowledge" use:enhance>
									<input type="hidden" name="key" value={alert.key} />
									<Button type="submit" variant="tertiary" size="sm">
										{m.alerts_page_acknowledge_button()}
									</Button>
								</form>
							{/if}
							{#if alert.closeUnbillable}
								<Button
									type="button"
									variant="danger"
									size="sm"
									onclick={() => {
										openUnbillableFor = alert.key;
										unbillableReason = '';
									}}
								>
									{alert.closeUnbillable.label}
								</Button>
							{/if}
						</div>
					</div>
					{#if alert.closeUnbillable}
						{@const closeUnbillable = alert.closeUnbillable}
						<form method="POST" action="?/unbillable" use:enhance>
							<input type="hidden" name="workUnitId" value={closeUnbillable.workUnitId} />
							<Dialog
								bind:open={
									() => openUnbillableFor === alert.key,
									(value) => {
										openUnbillableFor = value ? alert.key : null;
									}
								}
								title={m.alerts_unbillable_confirm_title()}
								role="alertdialog"
							>
								<p>{m.alerts_unbillable_confirm_body()}</p>
								<Field label={m.alerts_unbillable_reason_label()} error={form?.unbillableError}>
									<Textarea name="reason" bind:value={unbillableReason} rows={3} required />
								</Field>
								{#snippet actions()}
									<Button
										type="button"
										variant="tertiary"
										onclick={() => {
											openUnbillableFor = null;
										}}
									>
										{m.alerts_unbillable_confirm_cancel()}
									</Button>
									<Button type="submit" variant="danger">
										{m.alerts_unbillable_confirm_confirm()}
									</Button>
								{/snippet}
							</Dialog>
						</form>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</Page>

<style>
	.alert-list {
		margin-top: var(--space-4);
		display: flex;
		flex-direction: column;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		overflow: hidden;
	}
	.alert {
		padding: var(--space-3) var(--space-4);
		border-bottom: 1px solid var(--line);
	}
	.alert:last-child {
		border-bottom: none;
	}
	/* The rail (mockup's `.att--critical`/`.att--serious`/`.att--warning`):
	   real visual weight for severity, replacing the 14px status glyph. */
	.severity-critical {
		box-shadow: inset 3px 0 0 var(--status-critical);
	}
	.severity-serious {
		box-shadow: inset 3px 0 0 var(--status-serious);
	}
	.severity-warning {
		box-shadow: inset 3px 0 0 var(--status-warning);
	}
	.alert-body {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-1);
	}
	.alert-title {
		margin: 0;
		font-size: var(--text-md);
		font-weight: var(--weight-medium);
		color: var(--text-primary);
	}
	.alert-detail {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}
	.alert-ack {
		margin: 0;
		font-size: var(--text-xs);
		color: var(--text-muted);
	}
	.alert-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
		margin-top: var(--space-1);
	}
</style>
