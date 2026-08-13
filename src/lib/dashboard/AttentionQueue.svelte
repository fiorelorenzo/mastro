<!--
	#234's attention queue — the home screen's whole job: "what needs a
	decision from me right now." Same visual grammar `/alerts` already
	uses (#220's own fix for "an alert cannot be acted on" — a severity
	rail, a `Badge`, the resolving action as the primary button, the
	subject as a secondary one when it differs), scoped here to the four
	row kinds the issue names: a day at risk, an overdue invoice, a
	ceiling approaching, proposals pending. `rows` already carries every
	link/action `alertResolution` (#220) computed server-side — this
	component is presentation only.
-->
<script lang="ts">
	import Badge from '$lib/design/Badge.svelte';
	import Button from '$lib/design/Button.svelte';
	import EmptyState from '$lib/design/EmptyState.svelte';
	import * as m from '$lib/paraglide/messages';
	import type { AttentionRow } from '$lib/server/dashboard/attention';

	let { rows }: { rows: readonly AttentionRow[] } = $props();

	function severityLabel(severity: AttentionRow['severity']): string {
		if (severity === 'critical') return m.alerts_severity_critical();
		if (severity === 'serious') return m.alerts_severity_serious();
		if (severity === 'warning') return m.alerts_severity_warning();
		return m.dashboard_attention_severity_info();
	}
</script>

{#if rows.length === 0}
	<!-- #234: an empty queue is itself the day's answer, not a missing
	     section — a designed first-run/all-clear state, never a blank. -->
	<EmptyState
		icon="✓"
		title={m.dashboard_attention_empty_title()}
		body={m.dashboard_attention_empty_body()}
	/>
{:else}
	<ul class="queue">
		{#each rows as row (row.key)}
			<li class="row severity-{row.severity}">
				<Badge variant={row.severity} label={severityLabel(row.severity)} size="sm" />
				<div class="body">
					<p class="title">{row.title}</p>
					<p class="detail">{row.body}</p>
					<div class="actions">
						<Button href={row.actionHref} variant="primary" size="sm">{row.actionLabel}</Button>
						{#if row.subjectHref !== row.actionHref}
							<Button href={row.subjectHref} variant="secondary" size="sm">
								{row.subjectLabel}
							</Button>
						{/if}
					</div>
				</div>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.queue {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		background: var(--surface-1);
		border: 1px solid var(--border-hairline);
		border-radius: var(--radius-md);
		overflow: hidden;
	}
	.row {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		border-bottom: 1px solid var(--border-hairline);
	}
	.row:last-child {
		border-bottom: none;
	}
	/* Severity as a rail, never colour alone — the `Badge` beside it
	   carries the shape/glyph half of that guarantee. */
	.severity-critical {
		box-shadow: inset 3px 0 0 var(--status-critical);
	}
	.severity-serious {
		box-shadow: inset 3px 0 0 var(--status-serious);
	}
	.severity-warning {
		box-shadow: inset 3px 0 0 var(--status-warning);
	}
	.severity-info {
		box-shadow: inset 3px 0 0 var(--color-primary);
	}
	.body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.title {
		margin: 0;
		font-size: var(--text-md);
		font-weight: var(--weight-medium);
		color: var(--text-primary);
	}
	.detail {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}
	.actions {
		margin-top: var(--space-1);
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
</style>
