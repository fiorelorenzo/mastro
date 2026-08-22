<!--
	#214's evidence bundle: everything an argument needs about one day, on
	one screen — the approval and its verbatim excerpt, the archived
	original, the register entry for the month the day falls in, every
	clause note on the contract, and the invoice line the day landed on —
	plus the same bundle as one export (`?/export` below), invariant 4's
	"the source document, not a summary of it" carried all the way through:
	the zip download includes the archived original's own bytes, not just
	its file name.
-->
<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import { formatDateTime } from '$lib/i18n/format';
	import { Amount, Badge, Button, SourceDocument, workUnitStateBadge } from '$lib/design';
	import Page from '$lib/layout/Page.svelte';
	import Section from '$lib/layout/Section.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const bundle = $derived(data.bundle);
	const stateBadge = $derived(workUnitStateBadge(bundle.state));
</script>

<svelte:head><title>{m.dispute_bundle_page_title({ date: bundle.date })}</title></svelte:head>

{#snippet headerActions()}
	<Button
		href={resolve('/day/[id=uuid]/evidence/export', { id: bundle.workUnitId })}
		variant="primary"
	>
		{m.dispute_bundle_download_button()}
	</Button>
{/snippet}

<Page
	crumbs={data.crumbs}
	title={m.dispute_bundle_heading({ date: bundle.date })}
	actions={headerActions}
>
	<div class="state-row">
		<Badge variant={stateBadge.variant} label={stateBadge.label} />
	</div>

	<dl class="pairs">
		<dt>{m.day_detail_contract_label()}</dt>
		<dd>{bundle.contract.title}</dd>
		<dt>{m.day_detail_client_label()}</dt>
		<dd>{bundle.contract.clientName}</dd>
		<dt>{m.day_detail_scope_label()}</dt>
		<dd>{bundle.scope}</dd>
		<dt>{m.day_detail_quantity_label()}</dt>
		<dd>{bundle.quantity}</dd>
	</dl>

	<Section title={m.day_detail_approval_label()}>
		{#if bundle.approval}
			<blockquote class="excerpt">
				<span class="excerpt-label">{m.day_detail_approval_excerpt_label()}</span>
				<p>"{bundle.approval.excerpt}"</p>
			</blockquote>
			<p class="meta">
				{bundle.approval.channel} · {bundle.approval.sender} · {formatDateTime(
					bundle.approval.receivedAt
				)}
				{#if bundle.approval.messageId}· {bundle.approval.messageId}{/if}
			</p>
		{:else}
			<p class="muted">{m.day_detail_approval_none()}</p>
		{/if}
	</Section>

	<Section title={m.day_detail_document_label()}>
		<SourceDocument document={bundle.document} />
	</Section>

	<Section
		title={m.dispute_bundle_register_heading({
			from: bundle.register.from,
			to: bundle.register.to
		})}
	>
		{#if bundle.register.entry}
			<p>
				{bundle.register.entry.date} — {bundle.register.entry.scope} ({bundle.register.entry
					.quantity})
			</p>
			<p class="meta">
				{bundle.register.entry.approval.channel} · {bundle.register.entry.approval.sender} · {formatDateTime(
					bundle.register.entry.approval.receivedAt
				)}
			</p>
		{:else}
			<p class="muted">{m.dispute_bundle_register_empty()}</p>
		{/if}
		<p class="meta">
			{m.dispute_bundle_register_total({ total: String(bundle.register.totalQuantity) })}
		</p>
	</Section>

	<Section title={m.clause_note_section_heading()}>
		{#if bundle.clauseNotes.length > 0}
			{#each bundle.clauseNotes as note (note.id)}
				<p class="clause">
					<strong>{note.clauseReference}</strong>: "{note.verbatimText}" — {note.interpretationAdopted}
				</p>
			{/each}
		{:else}
			<p class="muted">{m.clause_note_empty()}</p>
		{/if}
	</Section>

	<Section title={m.day_detail_invoice_label()}>
		{#if bundle.invoiceLine}
			<div class="invoice-row">
				<Button
					href={resolve('/invoices/[id=uuid]', { id: bundle.invoiceLine.invoiceId })}
					variant="tertiary"
				>
					{m.day_detail_invoice_open({ number: bundle.invoiceLine.invoiceNumber })}
				</Button>
				<Amount
					minorUnits={bundle.invoiceLine.amount}
					currency={bundle.invoiceLine.currency}
					size="inline"
				/>
			</div>
		{:else}
			<p class="muted">{m.dispute_bundle_invoice_line_none()}</p>
		{/if}
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
	.excerpt {
		margin: 0;
		padding: var(--space-3);
		border-left: 3px solid var(--line-strong);
		background: var(--surface-2);
	}
	.excerpt-label {
		font-size: var(--text-xs);
		color: var(--text-muted);
	}
	.excerpt p {
		margin: var(--space-1) 0 0;
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
	.clause {
		margin: 0 0 var(--space-2);
		font-size: var(--text-sm);
	}
	.clause:last-child {
		margin-bottom: 0;
	}
	.invoice-row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		flex-wrap: wrap;
	}
</style>
