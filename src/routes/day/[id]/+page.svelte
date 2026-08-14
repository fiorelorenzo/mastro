<script lang="ts">
	// The one route for reading a day (#237). Replaces both the old
	// `/day/[id]` (a bare dl with no evidence, no money-in-context, no way
	// out of the risk state) and `/day/date/[date]` (folded away — see
	// `+page.server.ts`'s header comment and `day/calendar/+page.svelte`).
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import { formatDate, formatDateTime, formatDays, formatHours } from '$lib/i18n/format';
	import DataTable from '$lib/design/charts/DataTable.svelte';
	import {
		Amount,
		Badge,
		Banner,
		Button,
		Dialog,
		Field,
		Select,
		SourceDocument,
		Textarea,
		toasts,
		workUnitStateBadge,
		type WorkUnitStateValue
	} from '$lib/design';
	import Page from '$lib/layout/Page.svelte';
	import Section from '$lib/layout/Section.svelte';
	import type { TableColumn } from '$lib/design/charts/types';
	import type { ActionData, PageProps } from './$types';

	let { data, form }: PageProps & { form: ActionData } = $props();

	let linkApprovalId = $state('');

	// #228: the day's other exit from the risk state — closing it out as
	// `unbillable` when nobody will ever approve it. Confirmed through a
	// Dialog (never a bare click) since it is one-way: the state machine
	// has no edge back out of `unbillable`. Pre-filling `open`/`reason`
	// from `form` on a failed submit (a blank reason) means the dialog
	// reopens with what was typed rather than silently discarding it.
	let unbillableDialogOpen = $state(Boolean(form?.unbillableError));
	let unbillableReason = $state(form?.reason ?? '');
	let announcedUnbillable = false;
	$effect(() => {
		if (!form?.markedUnbillable || announcedUnbillable) return;
		announcedUnbillable = true;
		unbillableDialogOpen = false;
		toasts.push('neutral', m.day_detail_unbillable_toast());
	});

	function actorLabel(actor: { kind: string; email?: string; proposalReference?: string }): string {
		if (actor.kind === 'human') return actor.email ?? '';
		if (actor.kind === 'agent') {
			return m.day_detail_actor_agent({ reference: actor.proposalReference ?? '' });
		}
		return m.day_detail_actor_system();
	}

	function changeLabel(transition: {
		fromState: WorkUnitStateValue | null;
		toState: WorkUnitStateValue;
	}): string {
		return transition.fromState
			? m.day_detail_history_change({
					from: workUnitStateBadge(transition.fromState).label,
					to: workUnitStateBadge(transition.toState).label
				})
			: m.day_detail_history_change_initial({ to: workUnitStateBadge(transition.toState).label });
	}

	type HistoryRow = { when: string; change: string; reason: string; actor: string };

	const historyColumns: readonly TableColumn<HistoryRow>[] = [
		{ key: 'when', label: m.day_detail_history_column_when() },
		{ key: 'change', label: m.day_detail_history_column_change() },
		{ key: 'reason', label: m.day_detail_history_column_reason() },
		{ key: 'actor', label: m.day_detail_history_column_actor() }
	];

	const historyRows: HistoryRow[] = $derived(
		data.transitions.map((transition) => ({
			when: formatDateTime(transition.createdAt),
			change: changeLabel(transition),
			reason: transition.reason,
			actor: actorLabel(transition.actor)
		}))
	);

	// "1 giornata intera", "0,5 giornata" for a day-priced contract; "3,5
	// ore" for an hourly one — `quantityKind` is resolved server-side
	// against the rate card actually in force the day this was recorded
	// (see +page.server.ts), never guessed at from the number alone.
	const quantityPhrase = $derived(
		data.workUnit.quantityKind === 'hour'
			? formatHours(data.workUnit.quantity)
			: data.workUnit.quantity === 1
				? m.day_form_quantity_full()
				: data.workUnit.quantity === 0.5
					? m.day_form_quantity_half()
					: formatDays(data.workUnit.quantity)
	);

	const stateBadge = $derived(workUnitStateBadge(data.workUnit.state));
</script>

<svelte:head
	><title>{m.day_detail_page_title({ date: formatDate(data.workUnit.date) })}</title></svelte:head
>

<Page crumbs={data.crumbs} title={m.day_detail_heading({ date: formatDate(data.workUnit.date) })}>
	<div class="state-row">
		<Badge variant={stateBadge.variant} label={stateBadge.label} />
	</div>

	<dl class="pairs">
		<dt>{m.day_detail_contract_label()}</dt>
		<dd>{data.contract.title}</dd>
		<dt>{m.day_detail_client_label()}</dt>
		<dd>{data.contract.clientName}</dd>
		<dt>{m.day_detail_quantity_label()}</dt>
		<dd>{quantityPhrase}</dd>
		<dt>{m.day_detail_amount_label()}</dt>
		<dd>
			{#if data.amount !== null}
				<Amount major={data.amount} currency={data.contract.currency} size="inline" />
			{:else}
				{m.day_detail_amount_unpriced()}
			{/if}
		</dd>
		<dt>{m.day_detail_scope_label()}</dt>
		<dd>{data.workUnit.scope}</dd>
	</dl>

	{#if data.workUnit.state === 'worked_without_approval'}
		<Banner tone="critical">
			{m.day_state_worked_without_approval_description()}
			{#each data.clauseNotes as note (note.id)}
				<p class="clause">
					<strong>{note.clauseReference}</strong>: "{note.verbatimText}" — {note.interpretationAdopted}
				</p>
			{/each}
			{#snippet actions()}
				<Button
					href="/approvals/new?contractId={data.contract.id}&workUnitId={data.workUnit.id}"
					variant="primary"
				>
					{m.day_detail_approval_record_link()}
				</Button>
				<Button
					type="button"
					variant="danger"
					onclick={() => {
						unbillableDialogOpen = true;
					}}
				>
					{m.day_detail_mark_unbillable()}
				</Button>
			{/snippet}
		</Banner>

		<form method="POST" action="?/unbillable">
			<Dialog
				bind:open={unbillableDialogOpen}
				title={m.day_detail_unbillable_confirm_title()}
				role="alertdialog"
			>
				<p>{m.day_detail_unbillable_confirm_body()}</p>
				<Field label={m.day_detail_unbillable_reason_label()} error={form?.unbillableError}>
					<Textarea name="reason" bind:value={unbillableReason} rows={3} required />
				</Field>
				{#snippet actions()}
					<Button
						type="button"
						variant="tertiary"
						onclick={() => {
							unbillableDialogOpen = false;
						}}
					>
						{m.day_detail_unbillable_confirm_cancel()}
					</Button>
					<Button type="submit" variant="danger">
						{m.day_detail_unbillable_confirm_confirm()}
					</Button>
				{/snippet}
			</Dialog>
		</form>

		{#if data.linkableApprovals.length > 0}
			<form method="POST" action="?/link" class="link-form">
				<Field label={m.day_detail_approval_select_label()} error={form?.linkError}>
					<Select name="approvalId" bind:value={linkApprovalId} required>
						<option value="" disabled>{m.day_detail_approval_select_placeholder()}</option>
						{#each data.linkableApprovals as approval (approval.id)}
							<option value={approval.id}
								>{approval.sender} — {formatDateTime(approval.receivedAt)}</option
							>
						{/each}
					</Select>
				</Field>
				<Button type="submit" variant="secondary">{m.day_detail_approval_link_submit()}</Button>
			</form>
		{/if}
	{/if}

	<Section title={m.day_detail_approval_label()}>
		{#if data.approval}
			<blockquote class="excerpt">
				<span class="excerpt-label">{m.day_detail_approval_excerpt_label()}</span>
				<p>"{data.approval.excerpt}"</p>
			</blockquote>
			<p class="meta">{data.approval.sender} — {formatDateTime(data.approval.receivedAt)}</p>
		{:else}
			<p class="muted">{m.day_detail_approval_none()}</p>
		{/if}
	</Section>

	<Section title={m.day_detail_document_label()}>
		<SourceDocument document={data.sourceDocument} />
	</Section>

	{#if data.invoiceLine}
		<Section title={m.day_detail_invoice_label()}>
			<div class="invoice-row">
				<Button
					href={resolve('/invoices/[id]', { id: data.invoiceLine.invoiceId })}
					variant="tertiary"
				>
					{m.day_detail_invoice_open({ number: data.invoiceLine.invoiceNumber })}
				</Button>
				<Amount
					minorUnits={data.invoiceLine.amount}
					currency={data.invoiceLine.currency}
					size="inline"
				/>
			</div>
		</Section>
	{/if}

	<Section title={m.day_detail_history_heading()}>
		<DataTable
			columns={historyColumns}
			rows={historyRows}
			caption={m.day_detail_history_heading()}
		/>
	</Section>
</Page>

<style>
	.state-row {
		margin-top: var(--space-2);
	}
	.pairs {
		margin-top: var(--space-6);
		display: grid;
		grid-template-columns: max-content 1fr;
		column-gap: var(--space-4);
		row-gap: var(--space-2);
		font-size: var(--text-sm);
	}
	.pairs dt {
		color: var(--text-secondary);
	}
	.pairs dd {
		margin: 0;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.clause {
		margin: 0;
	}
	.link-form {
		margin-top: var(--space-4);
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-3);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-md);
		padding: var(--space-4);
	}
	.excerpt {
		margin: 0;
		padding-left: var(--space-4);
		border-left: 2px solid var(--line-strong);
	}
	.excerpt-label {
		display: block;
		font-size: var(--text-xs);
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.03em;
		margin-bottom: var(--space-1);
	}
	.excerpt p {
		margin: 0;
		font-style: italic;
		color: var(--text-primary);
	}
	.meta {
		margin: var(--space-2) 0 0;
		font-size: var(--text-xs);
		color: var(--text-muted);
	}
	.muted {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-muted);
	}
	.invoice-row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		flex-wrap: wrap;
	}
</style>
