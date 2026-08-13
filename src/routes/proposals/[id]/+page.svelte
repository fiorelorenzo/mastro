<!--
	The proposal review screen (#243). Evidence — the archived message in
	full, the matched sentence marked — is the heavier column; the proposed
	fields are the lighter one, each with a hint naming what it was read
	from. Confidence and validation both render for real now that wave 2
	added `confidence_reason`/`validation_error` to the row: a
	low-confidence proposal explains why the model hesitated, and one whose
	fields the database would reject names the offending field and cannot
	be accepted until it is corrected. A decided proposal renders the same
	layout read-only; an accepted one links the day it created.
-->
<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import { formatDate, formatDateTime, formatPercent } from '$lib/i18n/format';
	import { factLine } from '$lib/nav/crumbs';
	import { Amount, Badge, Banner, Button, Field, Input, Textarea } from '$lib/design';
	import SourceDocument from '$lib/design/SourceDocument.svelte';
	import Page from '$lib/layout/Page.svelte';
	import ProposalStatusBadge from '../ProposalStatusBadge.svelte';
	import {
		proposalConfidenceBadge,
		proposalFieldLabel,
		proposalQuantityLabel,
		proposalValidationField
	} from '../proposal-status';
	import { isFieldGroundedInExcerpt, splitOnExcerpt } from './evidence';
	import type { ActionData, PageProps } from './$types';

	let { data, form }: PageProps & { form: ActionData } = $props();

	const fieldEntries = $derived(Object.entries(data.proposal.proposedFields));
	const confidence = $derived(proposalConfidenceBadge(data.proposal.confidence));
	const validationField = $derived(
		proposalValidationField(
			data.proposal.validationError,
			fieldEntries.map(([field]) => field)
		)
	);
	const messageSplit = $derived(splitOnExcerpt(data.message.body, data.proposal.excerpt));

	// A validationError blocks Accept until the reviewer has touched the
	// offending field at least once — the true re-check is server-side, in
	// `acceptProposal` itself (its own doc comment explains why); this only
	// stops resubmitting the exact values already known to fail.
	let editedFields = $state<Set<string>>(new Set());
	function markEdited(field: string) {
		editedFields.add(field);
	}
	const acceptBlocked = $derived(validationField !== null && !editedFields.has(validationField));

	function inputType(value: unknown): 'number' | 'date' | 'text' {
		if (typeof value === 'number') return 'number';
		if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return 'date';
		return 'text';
	}

	const titleDate = $derived(
		typeof data.proposal.proposedFields.date === 'string'
			? formatDate(data.proposal.proposedFields.date)
			: ''
	);
	const titleQuantity = $derived(
		typeof data.proposal.proposedFields.quantity === 'number'
			? proposalQuantityLabel(data.proposal.proposedFields.quantity)
			: ''
	);
</script>

<svelte:head><title>{m.proposal_detail_page_title()}</title></svelte:head>

<Page
	crumbs={data.crumbs}
	title={m.proposal_review_heading({ date: titleDate, quantity: titleQuantity })}
	subtitle={factLine([data.contract?.title, data.contract?.clientLegalName])}
>
	{#snippet actions()}
		{#if data.proposal.status === 'pending'}
			<Badge
				variant={confidence.variant}
				label={`${confidence.label} · ${formatPercent(data.proposal.confidence)}`}
			/>
		{:else}
			<ProposalStatusBadge status={data.proposal.status} />
		{/if}
	{/snippet}

	<div class="layout">
		<!-- Evidence — the heavier column: empty for ~300px before this. -->
		<div class="card evidence">
			<div class="card-head">
				<h2>{m.proposal_evidence_heading()}</h2>
				<Badge variant="info" label={m.proposal_evidence_source_badge()} size="sm" />
			</div>

			<dl class="pairs">
				{#if data.message.from}
					<dt>{m.proposal_evidence_from_label()}</dt>
					<dd>{data.message.from}</dd>
				{/if}
				{#if data.message.to}
					<dt>{m.proposal_evidence_to_label()}</dt>
					<dd>{data.message.to}</dd>
				{/if}
				{#if data.message.receivedAt}
					<dt>{m.proposal_evidence_date_label()}</dt>
					<dd>{formatDateTime(data.message.receivedAt)}</dd>
				{/if}
				<dt>{m.proposal_evidence_subject_label()}</dt>
				<dd>{data.message.subject ?? m.proposal_queue_no_subject()}</dd>
			</dl>

			{#if messageSplit}
				<p class="message-body">
					{messageSplit.before}<mark>{messageSplit.match}</mark>{messageSplit.after}
				</p>
				<p class="hint">{m.proposal_evidence_excerpt_hint()}</p>
			{:else}
				<p class="message-body">{data.message.body}</p>
				<div>
					<h3>{m.proposal_detail_excerpt_heading()}</h3>
					<blockquote>{data.proposal.excerpt}</blockquote>
				</div>
			{/if}

			<div class="sep"></div>
			<SourceDocument document={data.sourceDocument} />
			<p class="hint">{m.proposal_evidence_document_hint()}</p>
		</div>

		<!-- Proposed fields — lighter, secondary column -->
		<div class="fields">
			{#if data.proposal.status === 'pending'}
				<form method="POST" action="?/accept" class="card fields-form">
					{#each fieldEntries as [field, value] (field)}
						{@const grounded = isFieldGroundedInExcerpt(value, data.proposal.excerpt)}
						{@const invalid = field === validationField}
						<Field
							label={proposalFieldLabel(field)}
							hint={grounded
								? m.proposal_field_hint_grounded()
								: m.proposal_field_hint_not_grounded()}
							error={invalid ? (data.proposal.validationError ?? undefined) : undefined}
						>
							{#if inputType(value) === 'number'}
								<Input
									name={field}
									type="number"
									step="any"
									numeric
									value={value as number}
									oninput={() => markEdited(field)}
								/>
							{:else if inputType(value) === 'date'}
								<Input
									name={field}
									type="date"
									value={value as string}
									oninput={() => markEdited(field)}
								/>
							{:else if field === 'notes'}
								<Textarea name={field} value={value as string} oninput={() => markEdited(field)} />
							{:else}
								<Input
									name={field}
									type="text"
									value={value as string}
									oninput={() => markEdited(field)}
								/>
							{/if}
						</Field>
					{/each}

					{#if data.amount !== null}
						<div class="stat">
							<span class="stat-label">{m.proposal_review_amount_label()}</span>
							<Amount major={data.amount} currency={data.currency} size="md" />
						</div>
					{/if}

					{#if data.proposal.confidenceReason}
						<Banner tone="warning">
							<strong>{confidence.label} ({formatPercent(data.proposal.confidence)})</strong>: {data
								.proposal.confidenceReason}
						</Banner>
					{/if}

					{#if data.proposal.validationError}
						<Banner tone="critical">
							<strong>{m.proposal_validation_banner_heading()}</strong>
							{data.proposal.validationError}
						</Banner>
					{/if}

					{#if form?.decisionError}
						<p class="decision-error" role="alert">
							{m.proposal_detail_decision_error_heading()}
							{form.decisionError}
						</p>
					{/if}

					<div class="submit-stack">
						<Button type="submit" variant="primary" disabled={acceptBlocked}>
							{m.proposal_review_accept_submit()}
						</Button>
						<Button type="submit" formaction="?/reject" variant="danger">
							{m.proposal_detail_reject_submit()}
						</Button>
						<Button href={resolve('/proposals')} variant="tertiary">
							{m.proposal_review_skip()}
						</Button>
					</div>
				</form>
			{:else}
				<div class="card decided-fields">
					<dl class="pairs">
						{#each fieldEntries as [field] (field)}
							<dt>{proposalFieldLabel(field)}</dt>
							<dd>
								{String((data.proposal.acceptedFields ?? data.proposal.proposedFields)[field])}
							</dd>
						{/each}
					</dl>
					{#if data.amount !== null}
						<div class="stat">
							<span class="stat-label">{m.proposal_review_amount_label()}</span>
							<Amount major={data.amount} currency={data.currency} size="md" />
						</div>
					{/if}
					{#if data.proposal.status === 'accepted' && data.proposal.resultId}
						<Button href={resolve('/day/[id]', { id: data.proposal.resultId })} variant="primary">
							{m.proposal_detail_result_link()}
						</Button>
					{/if}
				</div>
			{/if}
		</div>
	</div>

	{#if data.siblings.count > 1}
		<div class="siblings">
			<span class="muted">
				{m.proposal_review_sibling_position({
					index: data.siblings.position,
					count: data.siblings.count
				})}
			</span>
			<div class="siblings-nav">
				<Button
					href={data.siblings.previous
						? resolve('/proposals/[id]', { id: data.siblings.previous.id })
						: undefined}
					variant="secondary"
					size="sm"
					disabled={!data.siblings.previous}
				>
					{m.proposal_review_sibling_previous({
						label: data.siblings.previous?.date ? formatDate(data.siblings.previous.date) : ''
					})}
				</Button>
				<Button
					href={data.siblings.next
						? resolve('/proposals/[id]', { id: data.siblings.next.id })
						: undefined}
					variant="secondary"
					size="sm"
					disabled={!data.siblings.next}
				>
					{m.proposal_review_sibling_next({
						label: data.siblings.next?.date ? formatDate(data.siblings.next.date) : ''
					})}
				</Button>
			</div>
		</div>
	{/if}

	{#if data.proposal.status !== 'pending'}
		<section class="decided-section">
			<h2>{m.proposal_detail_decided_heading()}</h2>
			<dl class="pairs">
				<dt>{m.proposal_detail_decided_by_label()}</dt>
				<dd>{data.proposal.decidedBy}</dd>
				<dt>{m.proposal_detail_decided_at_label()}</dt>
				<dd>{data.proposal.decidedAt ? formatDateTime(data.proposal.decidedAt) : ''}</dd>
			</dl>

			{#if data.proposal.status === 'accepted'}
				<h3>{m.proposal_detail_changes_heading()}</h3>
				{#if data.proposal.changes.length === 0}
					<p class="muted">{m.proposal_detail_no_changes()}</p>
				{:else}
					<ul>
						{#each data.proposal.changes as change (change.field)}
							<li>
								{m.proposal_detail_change_row({
									field: proposalFieldLabel(change.field),
									proposed: String(change.proposed),
									accepted: String(change.accepted)
								})}
							</li>
						{/each}
					</ul>
				{/if}
			{/if}
		</section>
	{/if}
</Page>

<style>
	.layout {
		display: grid;
		grid-template-columns: 2fr 1fr;
		gap: var(--space-5);
		margin-top: var(--space-5);
		align-items: start;
	}
	.card {
		border: 1px solid var(--border-hairline);
		border-radius: var(--radius-md);
		background: var(--surface-1);
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.card-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}
	.card-head h2 {
		margin: 0;
		font-size: var(--text-lg);
		font-weight: var(--weight-medium);
		color: var(--text-primary);
	}
	.pairs {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: var(--space-1) var(--space-3);
		margin: 0;
		font-size: var(--text-sm);
	}
	.pairs dt {
		color: var(--text-muted);
	}
	.pairs dd {
		margin: 0;
		min-width: 0;
		overflow-wrap: anywhere;
		color: var(--text-primary);
	}
	.message-body {
		margin: 0;
		font-size: var(--text-md);
		line-height: 1.6;
		color: var(--text-primary);
		white-space: pre-wrap;
	}
	.message-body mark {
		background: color-mix(in srgb, var(--status-warning) 35%, transparent);
		color: inherit;
		border-radius: var(--radius-sm);
		padding: 0 0.15em;
	}
	.hint {
		margin: 0;
		font-size: var(--text-xs);
		color: var(--text-muted);
	}
	blockquote {
		margin: var(--space-1) 0 0;
		padding-left: var(--space-3);
		border-left: 2px solid var(--line-strong);
		font-size: var(--text-sm);
		font-style: italic;
		color: var(--text-secondary);
	}
	.sep {
		border-top: 1px solid var(--border-hairline);
	}
	.fields {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.fields-form {
		align-self: start;
	}
	.decided-fields {
		align-items: flex-start;
	}
	.stat {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		padding-top: var(--space-2);
		border-top: 1px solid var(--border-hairline);
	}
	.stat-label {
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}
	.decision-error {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--color-danger);
	}
	.submit-stack {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.siblings {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		margin-top: var(--space-5);
		padding-top: var(--space-3);
		border-top: 1px solid var(--border-hairline);
	}
	.siblings-nav {
		display: flex;
		gap: var(--space-2);
	}
	.muted {
		font-size: var(--text-sm);
		color: var(--text-muted);
	}
	.decided-section {
		margin-top: var(--space-5);
		padding-top: var(--space-4);
		border-top: 1px solid var(--border-hairline);
	}
	.decided-section h2 {
		font-size: var(--text-lg);
		font-weight: var(--weight-medium);
		margin: 0 0 var(--space-2);
	}
	.decided-section h3 {
		font-size: var(--text-md);
		font-weight: var(--weight-medium);
		margin: var(--space-4) 0 var(--space-1);
	}
	.decided-section ul {
		margin: 0;
		padding-left: var(--space-4);
		font-size: var(--text-sm);
	}
	@media (max-width: 767px) {
		.layout {
			grid-template-columns: 1fr;
		}
	}
</style>
