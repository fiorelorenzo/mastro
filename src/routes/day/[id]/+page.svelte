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
	import { submitting } from '$lib/design/submitting.svelte';
	import type { TableColumn } from '$lib/design/charts/types';
	import type { ActionData, PageProps } from './$types';

	let { data, form }: PageProps & { form: ActionData } = $props();

	const unbillable = submitting();
	const link = submitting();
	const dispute = submitting();
	const resolveDispute = submitting();
	const worked = submitting();
	// Reopens on a failed submit (the date-guard rejection below), the
	// same as `unbillableDialogOpen` — a stale page posted through it and
	// the server said no.
	let workedDialogOpen = $state(Boolean(form?.workedError));
	let announcedWorked = false;
	$effect(() => {
		if (!form?.recorded || announcedWorked) return;
		announcedWorked = true;
		workedDialogOpen = false;
		toasts.push('neutral', m.day_detail_worked_toast());
	});

	// The link-approval select's current pick — the reviewer's own
	// in-progress choice among `data.linkableApprovals`, not a mirror to
	// keep synced. Left alone by a background `invalidateAll()` for the
	// same reason every dialog/reason state below is: this form's own
	// submit (plain POST) fully reloads the page regardless.
	let linkApprovalId = $state('');

	// #228: the day's other exit from the risk state — closing it out as
	// `unbillable` when nobody will ever approve it. Confirmed through a
	// Dialog (never a bare click) since it is one-way: the state machine
	// has no edge back out of `unbillable`. Pre-filling `open`/`reason`
	// from `form` on a failed submit (a blank reason) means the dialog
	// reopens with what was typed rather than silently discarding it.
	//
	// All three dialogs below (`unbillable`, `dispute`, `resolveDispute`)
	// read only from `form`, never from `data` — a background
	// `invalidateAll()` updates `data`, not `form`, so none of this needs
	// resyncing on that path. `data.workUnit.state` itself is read live
	// through `$derived`s (`stateBadge` etc.) below, so the badge and the
	// dialogs can never disagree about which exit is actually still open.
	let unbillableDialogOpen = $state(Boolean(form?.unbillableError));
	let unbillableReason = $state(form?.reason ?? '');
	let announcedUnbillable = false;
	$effect(() => {
		if (!form?.markedUnbillable || announcedUnbillable) return;
		announcedUnbillable = true;
		unbillableDialogOpen = false;
		toasts.push('neutral', m.day_detail_unbillable_toast());
	});

	// #214's path in: confirmed through a Dialog, the same shape #228's
	// unbillable exit already uses, since disputing is consequential
	// enough to name a reason for even though — unlike unbillable — it
	// has a way back.
	let disputeDialogOpen = $state(Boolean(form?.disputeError));
	let disputeReason = $state(form?.reason ?? '');
	let announcedDisputed = false;
	$effect(() => {
		if (!form?.disputed || announcedDisputed) return;
		announcedDisputed = true;
		disputeDialogOpen = false;
		toasts.push('neutral', m.day_detail_dispute_toast());
	});

	// #214's way back: `disputed -> invoiced`, the only edge the state
	// machine allows out of the dispute state.
	let resolveDisputeDialogOpen = $state(Boolean(form?.resolveDisputeError));
	let resolveDisputeReason = $state(form?.reason ?? '');
	let announcedDisputeResolved = false;
	$effect(() => {
		if (!form?.disputeResolved || announcedDisputeResolved) return;
		announcedDisputeResolved = true;
		resolveDisputeDialogOpen = false;
		toasts.push('neutral', m.day_detail_resolve_dispute_toast());
	});

	// #370: `reject` (proposed -> rejected) and `revoke` (approved ->
	// revoked) — the two remaining branches AGENTS.md names alongside
	// `disputed`/`unbillable`, both previously reachable only by
	// hand-written SQL. Simpler dialogs than the three above: no reason
	// field, because there is nothing to add that the source evidence
	// (the proposal's document, the approval's excerpt) does not already
	// say, and no dedicated Cancel button text — the Dialog's own × close
	// (`m.dialog_close_label()`) is the way out, since neither of these
	// four messages exists as a translated string and #370 forbids
	// inventing one. Both are terminal, like `unbillable`: the trigger's
	// allowed-edge list has no edge out of `revoked` or `rejected`.
	const reject = submitting();
	let rejectDialogOpen = $state(false);
	let announcedRejected = false;
	$effect(() => {
		if (!form?.rejected || announcedRejected) return;
		announcedRejected = true;
		rejectDialogOpen = false;
		toasts.push('neutral', m.day_detail_reject_toast());
	});

	const revoke = submitting();
	let revokeDialogOpen = $state(false);
	let announcedRevoked = false;
	$effect(() => {
		if (!form?.revoked || announcedRevoked) return;
		announcedRevoked = true;
		revokeDialogOpen = false;
		toasts.push('neutral', m.day_detail_revoke_toast());
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

	{#if data.workUnit.state === 'proposed'}
		<div class="lifecycle-actions">
			<Button
				type="button"
				variant="danger"
				size="sm"
				onclick={() => {
					rejectDialogOpen = true;
				}}
			>
				{m.day_detail_reject_action()}
			</Button>
		</div>
		<form method="POST" action="?/reject" onsubmit={reject.onsubmit}>
			<Dialog
				bind:open={rejectDialogOpen}
				title={m.day_detail_reject_confirm_title()}
				role="alertdialog"
			>
				<p>{m.day_detail_reject_confirm_body()}</p>
				{#snippet actions()}
					<Button type="submit" variant="danger" loading={reject.busy}>
						{m.day_detail_reject_action()}
					</Button>
				{/snippet}
			</Dialog>
		</form>
	{:else if data.workUnit.state === 'approved'}
		<div class="lifecycle-actions">
			{#if data.workUnit.date <= data.workUnit.today}
				<Button
					type="button"
					variant="primary"
					size="sm"
					onclick={() => {
						workedDialogOpen = true;
					}}
				>
					{m.day_detail_mark_worked_action()}
				</Button>
			{/if}
			<Button
				type="button"
				variant="danger"
				size="sm"
				onclick={() => {
					revokeDialogOpen = true;
				}}
			>
				{m.day_detail_revoke_action()}
			</Button>
		</div>
		{#if data.workUnit.date <= data.workUnit.today}
			<form method="POST" action="?/worked" onsubmit={worked.onsubmit}>
				<Dialog
					bind:open={workedDialogOpen}
					title={m.day_detail_worked_confirm_title()}
					role="alertdialog"
				>
					{#if form?.workedError}
						<Banner tone="critical">{form.workedError}</Banner>
					{/if}
					<p>{m.day_detail_worked_confirm_body({ date: formatDate(data.workUnit.date) })}</p>
					{#snippet actions()}
						<Button type="submit" variant="primary" loading={worked.busy}>
							{m.day_detail_mark_worked_action()}
						</Button>
					{/snippet}
				</Dialog>
			</form>
		{/if}
		<form method="POST" action="?/revoke" onsubmit={revoke.onsubmit}>
			<Dialog
				bind:open={revokeDialogOpen}
				title={m.day_detail_revoke_confirm_title()}
				role="alertdialog"
			>
				<p>{m.day_detail_revoke_confirm_body()}</p>
				{#snippet actions()}
					<Button type="submit" variant="danger" loading={revoke.busy}>
						{m.day_detail_revoke_action()}
					</Button>
				{/snippet}
			</Dialog>
		</form>
	{/if}

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

		<form method="POST" action="?/unbillable" onsubmit={unbillable.onsubmit}>
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
					<Button type="submit" variant="danger" loading={unbillable.busy}>
						{m.day_detail_unbillable_confirm_confirm()}
					</Button>
				{/snippet}
			</Dialog>
		</form>

		{#if data.linkableApprovals.length > 0}
			<form method="POST" action="?/link" class="link-form" onsubmit={link.onsubmit}>
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
				<Button type="submit" variant="secondary" loading={link.busy}
					>{m.day_detail_approval_link_submit()}</Button
				>
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

			{#if data.workUnit.state === 'invoiced'}
				<div class="dispute-actions">
					<Button
						type="button"
						variant="secondary"
						size="sm"
						onclick={() => {
							disputeDialogOpen = true;
						}}
					>
						{m.day_detail_dispute_button()}
					</Button>
				</div>
				<form method="POST" action="?/dispute" onsubmit={dispute.onsubmit}>
					<Dialog
						bind:open={disputeDialogOpen}
						title={m.day_detail_dispute_confirm_title()}
						role="alertdialog"
					>
						<p>{m.day_detail_dispute_confirm_body()}</p>
						<Field label={m.day_detail_dispute_reason_label()} error={form?.disputeError}>
							<Textarea name="reason" bind:value={disputeReason} rows={3} required />
						</Field>
						{#snippet actions()}
							<Button
								type="button"
								variant="tertiary"
								onclick={() => {
									disputeDialogOpen = false;
								}}
							>
								{m.day_detail_dispute_confirm_cancel()}
							</Button>
							<Button type="submit" variant="primary" loading={dispute.busy}>
								{m.day_detail_dispute_confirm_confirm()}
							</Button>
						{/snippet}
					</Dialog>
				</form>
			{:else if data.workUnit.state === 'disputed'}
				<div class="dispute-actions">
					<Button
						type="button"
						variant="secondary"
						size="sm"
						onclick={() => {
							resolveDisputeDialogOpen = true;
						}}
					>
						{m.day_detail_resolve_dispute_button()}
					</Button>
					<Button
						href={resolve('/day/[id]/evidence', { id: data.workUnit.id })}
						variant="tertiary"
						size="sm"
					>
						{m.day_detail_evidence_bundle_link()}
					</Button>
				</div>
				<form method="POST" action="?/resolveDispute" onsubmit={resolveDispute.onsubmit}>
					<Dialog
						bind:open={resolveDisputeDialogOpen}
						title={m.day_detail_resolve_dispute_confirm_title()}
						role="alertdialog"
					>
						<p>{m.day_detail_resolve_dispute_confirm_body()}</p>
						<Field
							label={m.day_detail_resolve_dispute_reason_label()}
							error={form?.resolveDisputeError}
						>
							<Textarea name="reason" bind:value={resolveDisputeReason} rows={3} required />
						</Field>
						{#snippet actions()}
							<Button
								type="button"
								variant="tertiary"
								onclick={() => {
									resolveDisputeDialogOpen = false;
								}}
							>
								{m.day_detail_resolve_dispute_confirm_cancel()}
							</Button>
							<Button type="submit" variant="primary" loading={resolveDispute.busy}>
								{m.day_detail_resolve_dispute_confirm_confirm()}
							</Button>
						{/snippet}
					</Dialog>
				</form>
			{/if}
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
	.lifecycle-actions {
		/* #370: bottom margin as well as top. The `proposed` and `approved`
		   actions are the first ones on this page to sit between the detail
		   list and the next heading rather than inside a Banner, and without
		   it the button reads as part of the "Approval" section below it. */
		margin-top: var(--space-3);
		margin-bottom: var(--space-6);
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
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
	.dispute-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
		margin-top: var(--space-3);
	}
</style>
