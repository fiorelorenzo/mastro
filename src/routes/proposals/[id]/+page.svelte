<!--
	The proposal review screen (#243, #86/#87). What is heavy here depends
	on what is being reviewed, and the layout follows it rather than
	assuming: a `work_unit` proposal is a long archived message against
	three fields, so the evidence is the major column; a `contract`
	proposal is a short excerpt and a PDF against a whole contract to fill
	in, so the form is (#280 — the fixed 2fr/1fr weighting used to put ten
	stacked fieldsets in a 271px column, 3050px tall, next to 464px of
	evidence and 2600px of blank screen). In form-major mode the evidence
	sticks to the viewport instead of scrolling away after the first
	screen, the fieldsets flow two-up instead of stacking, and the
	decision stays pinned to the bottom carrying the reason Accept is
	disabled — none of which a reviewer should have to scroll to find.
	A `work_unit` proposal's fields are a flat list, each with a hint
	naming what it was read from. A `contract` proposal's are not: the
	proposed client, the contract terms and the rate cards render as their
	own cards, and each flagged clause renders its verbatim text next to
	the two or more readings it admits, as a choice a reviewer has to make
	— Accept stays disabled until every flag has one — recorded onto the
	clause note `applyProposal` writes. An `invoice` proposal renders
	number, date, client, lines and totals, read-only, against the
	excerpt: #87's brief never asks for edits here, only for a reader to
	see what the model read off the PDF. Confidence and validation both
	render for real: a low-confidence proposal explains why the model
	hesitated, and one whose fields the database would reject names the
	offending field, inline, and cannot be accepted until it is corrected
	— never a bare failure after the click. A decided proposal renders the
	same layout read-only; an accepted one links the day, contract or
	invoice it created.
-->
<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import { getLocale } from '$lib/paraglide/runtime';
	import {
		formatAmount,
		formatDate,
		formatDateTime,
		formatNumber,
		formatPercent
	} from '$lib/i18n/format';
	import { factLine } from '$lib/nav/crumbs';
	import { minorUnitsToDecimalString } from '$lib/money';
	import {
		AmountInput,
		Amount,
		Badge,
		Banner,
		Button,
		Checkbox,
		countryOptions,
		Dialog,
		Field,
		Input,
		Radio,
		Select,
		Textarea,
		toasts
	} from '$lib/design';
	import Table from '$lib/design/Table.svelte';
	import type { TableColumn } from '$lib/design/table';
	import SourceDocument from '$lib/design/SourceDocument.svelte';
	import Page from '$lib/layout/Page.svelte';
	import ProposalStatusBadge from '../ProposalStatusBadge.svelte';
	import {
		proposalConfidenceBadge,
		proposalFieldLabel,
		proposalQuantityLabel
	} from '../proposal-status';
	import { proposalIssueMessage } from '$lib/i18n/proposal-issue';
	import { submitting } from '$lib/design/submitting.svelte';
	import { isFieldGroundedInExcerpt, splitOnExcerpt } from './evidence';
	import type {
		ExtractedContractCandidate,
		ExtractedRateCard
	} from '$lib/server/agent/contract-extraction';
	import {
		contractRenewalTypes,
		expensePolicyKinds,
		invoicingCadences,
		paymentTermsKinds,
		expensePolicyKindLabel,
		invoicingCadenceLabel,
		paymentTermsKindLabel,
		renewalTypeLabel
	} from '../../clients/[id]/contracts/contract-enums';
	import {
		disbursementPeriodLabel,
		rateCardKindLabel,
		rateUnitLabel
	} from '../../clients/[id]/contracts/[contractId]/rate-cards/rate-card-enums';
	import type { ActionData, PageProps } from './$types';

	let { data, form }: PageProps & { form: ActionData } = $props();

	const pending = $derived(data.proposal.status === 'pending');

	const fieldEntries = $derived(Object.entries(data.proposal.proposedFields));
	const confidence = $derived(proposalConfidenceBadge(data.proposal.confidence));
	const messageSplit = $derived(splitOnExcerpt(data.message.body, data.proposal.excerpt));

	// A pending proposal's own validation issue blocks Accept until the
	// reviewer has touched the offending field at least once — the true
	// re-check is server-side, in `acceptProposal` itself (its own doc
	// comment explains why); this only stops resubmitting the exact values
	// already known to fail.
	// `SvelteSet`, not `$state(new Set())`: `$state` proxies plain objects and
	// arrays, never a Set, so `.add()` on one mutates without notifying and
	// nothing that reads it ever re-renders. The gate below therefore never
	// reopened when a reviewer fixed the field it was complaining about —
	// found by driving the screen rather than by reading it.
	const editedFields = new SvelteSet<string>();
	function markEdited(field: string) {
		editedFields.add(field);
	}

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

	const pageHeading = $derived(
		data.proposal.targetType === 'contract' && data.contractCandidate
			? m.proposal_review_heading_contract({ client: data.contractCandidate.client.legalName })
			: data.proposal.targetType === 'invoice' && data.invoiceFields
				? m.proposal_review_heading_invoice({ number: data.invoiceFields.number })
				: m.proposal_review_heading({ date: titleDate, quantity: titleQuantity })
	);
	const acceptSubmitLabel = $derived(
		data.proposal.targetType === 'contract'
			? m.proposal_review_accept_submit_contract()
			: data.proposal.targetType === 'invoice'
				? m.proposal_review_accept_submit_invoice()
				: m.proposal_review_accept_submit()
	);

	// The one issue the database would raise against this proposal exactly
	// as proposed (`row.validationIssue`, computed once at creation and
	// re-checked by `acceptProposal` before every accept) — translated once
	// here so every per-field error, both Banners below and the work_unit
	// field loop all read the same value and can never disagree about what
	// is wrong. Only meaningful while pending: a decided proposal's fields
	// render read-only, so nothing is ever marked invalid again.
	const validationIssue = $derived(pending ? data.proposal.validationIssue : null);
	const validationMessage = $derived(
		validationIssue ? proposalIssueMessage(validationIssue) : null
	);
	/** Whether `field` is the one input `validationIssue` names — `null`
	 *  when the issue is not about a single field (a missing contract, two
	 *  overlapping rate cards), in which case no input is marked invalid
	 *  and the Banner carries the whole story instead. */
	function fieldError(field: string): string | undefined {
		return validationIssue?.field === field ? (validationMessage ?? undefined) : undefined;
	}

	// One chosen reading per flagged clause, required before Accept: #86's
	// "an ambiguous clause requires an explicit choice", enforced here
	// independently of whatever `validationIssue` currently says (that
	// issue only ever names the *first* thing wrong, which may be
	// an unrelated NOT NULL field checked earlier in the same switch).
	//
	// Left alone by a background `invalidateAll()`: these are the
	// reviewer's own choices for clauses that do not change once a
	// proposal exists, so there is nothing for a resync to correct, only
	// in-progress decisions it could destroy.
	let clauseReadings = $state<string[]>(
		(data.contractCandidate?.clauseFlags ?? []).map((flag) => flag.interpretationAdopted ?? '')
	);
	const unresolvedClauseCount = $derived(clauseReadings.filter((reading) => !reading).length);

	// The client section's own state (design: "the client behind an
	// extracted contract is always an explicit choice"). Defaults to
	// 'existing' only when `data.clientMatchId` gives it something to
	// preselect — the same starting point the old accept dispatcher's own
	// find-or-create silently produced when a tax id matched, now an
	// explicit default a reviewer can see and override rather than a
	// decision nobody saw. No match — including every client having no
	// tax id at all, or no clients existing yet — falls back to 'new',
	// the same default the no-match path always produced before this.
	//
	// Also left alone by a background `invalidateAll()`, same reasoning as
	// `clauseReadings`: a reviewer choosing 'existing' vs 'new' (and which
	// client) is a decision in progress, not a value that tracks anything
	// current on the server.
	let clientMode = $state<'existing' | 'new'>(data.clientMatchId ? 'existing' : 'new');
	let selectedClientId = $state(data.clientMatchId ?? '');
	const selectedClient = $derived(
		data.existingClients.find((row) => row.id === selectedClientId) ?? null
	);

	// The vocabulary a document's client and a linked client can differ
	// on — every field a contract PDF's extraction carries (#86's own
	// `ExtractedClient`), reusing `client_form_*`'s own labels rather than
	// naming the fields a second time.
	type ClientFieldKey =
		| 'legalName'
		| 'taxId'
		| 'vatId'
		| 'country'
		| 'addressLine1'
		| 'addressLine2'
		| 'addressCity'
		| 'addressPostalCode'
		| 'addressRegion';
	const CLIENT_DIFF_FIELDS: { key: ClientFieldKey; label: () => string }[] = [
		{ key: 'legalName', label: m.client_form_legal_name_label },
		{ key: 'taxId', label: m.client_form_tax_id_label },
		{ key: 'vatId', label: m.client_form_vat_id_label },
		{ key: 'country', label: m.client_form_country_label },
		{ key: 'addressLine1', label: m.client_form_address_line1_label },
		{ key: 'addressLine2', label: m.client_form_address_line2_label },
		{ key: 'addressCity', label: m.client_form_city_label },
		{ key: 'addressPostalCode', label: m.client_form_postal_code_label },
		{ key: 'addressRegion', label: m.client_form_region_label }
	];
	/** Only the fields where the document's value differs from what is on
	 * file — a linked client with nothing to reconcile shows no rows at
	 * all, per `proposal_contract_client_diff_none`. */
	function clientDiffs(documentClient: { [K in ClientFieldKey]: string | null }) {
		if (!selectedClient) return [];
		return CLIENT_DIFF_FIELDS.filter(({ key }) => documentClient[key] !== selectedClient![key]);
	}

	// Blocked while a flagged clause still needs its reading chosen (#86's
	// "an ambiguous clause requires an explicit choice"), and — for a
	// target type this screen never lets a reviewer edit (`invoice`) —
	// while the database would reject the proposal as proposed.
	//
	// A `contract` is gated the same way a `work_unit` already was, and for
	// a reason worth stating: choosing a reading records the interpretation
	// on the clause note, it does not fill in the field the clause
	// determines — that is a separate Select the reviewer sets. Gating on
	// the clause alone therefore enabled Accept while `renewalType` was
	// still null, and the reviewer learned that only from a failed submit.
	// Observed on a real proposal built from the committed fixture, which
	// is exactly the doomed click the field-level error exists to prevent.
	const acceptBlocked = $derived(
		data.proposal.targetType === 'invoice'
			? validationIssue !== null
			: data.proposal.targetType === 'contract'
				? unresolvedClauseCount > 0 ||
					(clientMode === 'existing' && selectedClientId === '') ||
					(validationIssue !== null &&
						validationIssue.field !== null &&
						!editedFields.has(validationIssue.field))
				: validationIssue !== null &&
					validationIssue.field !== null &&
					!editedFields.has(validationIssue.field)
	);

	// Why Accept is disabled, said on the same screen as the disabled
	// button rather than discovered by scrolling the form looking for a
	// red field (#280). Every branch reuses the message the offending
	// control already renders inline, so the bar and the field never say
	// two different things about one problem. Most specific first: a
	// clause with no reading chosen is a decision the reviewer has not
	// taken, and it outranks a `validationIssue` that may well be about
	// the very field that clause determines.
	const acceptBlockedReason = $derived(
		!pending || !acceptBlocked
			? null
			: data.proposal.targetType === 'contract' && unresolvedClauseCount > 0
				? m.proposal_contract_clause_reading_required_error()
				: data.proposal.targetType === 'contract' &&
					  clientMode === 'existing' &&
					  selectedClientId === ''
					? m.proposal_contract_client_choice_required_error()
					: validationMessage
	);

	// A contract proposal's form is the work; a work_unit's evidence is
	// (see the file header). `formMajor` is the one switch both the page
	// width and the two-column weighting read, so the two can never
	// disagree — a wide page with a narrow form column is the bug this
	// replaces.
	const formMajor = $derived(data.proposal.targetType === 'contract');

	// The three fields a Select drives conditionally — mirrors
	// `ContractForm.svelte`'s own pattern exactly, so a reviewer resolving
	// an ambiguous field sees the same conditional shape a person creating
	// a contract by hand would.
	let renewalType = $state(data.contractCandidate?.contract.renewalType ?? '');
	let paymentTermsKind = $state(data.contractCandidate?.contract.paymentTerms?.kind ?? '');
	let expensePolicyKind = $state(data.contractCandidate?.contract.expensePolicy?.kind ?? '');
	let currency = $state(data.contractCandidate?.contract.currency ?? 'EUR');
	const countries = $derived(countryOptions(getLocale()));

	const expensePolicyCapValue = $derived(
		data.contractCandidate?.contract.expensePolicy?.kind === 'reimbursed_with_cap'
			? minorUnitsToDecimalString(data.contractCandidate.contract.expensePolicy.capAmount, currency)
			: ''
	);

	// A `{@const}` block cannot be a direct child of `<form>`, only of a
	// block (`{#if}`, `{#each}`, `{#snippet}`, …) — computed here instead,
	// same as `ContractForm.svelte`'s own module-scope column definitions
	// would if that page needed one.
	const rateCardColumns = $derived(
		data.contractCandidate
			? ([
					{
						key: 'validity',
						label: m.rate_card_column_validity(),
						format: (row: ExtractedRateCard) =>
							`${formatDate(row.validFrom)} – ${row.validTo ? formatDate(row.validTo) : m.rate_card_valid_to_open()}`
					},
					{
						key: 'kind',
						label: m.rate_card_column_kind(),
						format: (row: ExtractedRateCard) => rateCardKindLabel(row.kind)
					},
					{
						key: 'amount',
						label: m.rate_card_column_amount(),
						align: 'end' as const,
						format: (row: ExtractedRateCard) => {
							const perUnit = `${formatAmount(row.amount, currency)} / ${rateUnitLabel(row.unit)}`;
							return row.disbursementPeriod
								? `${perUnit} (${disbursementPeriodLabel(row.disbursementPeriod)})`
								: perUnit;
						}
					}
				] satisfies readonly TableColumn<ExtractedRateCard>[])
			: []
	);

	// A save announces itself (#207): each action tags its own outcome so
	// the toast reads correctly regardless of which button was pressed.
	// This form has no `use:enhance`, so a submit is a full-page
	// navigation — a fresh mount, `form` populated from that navigation's
	// own SSR — and this effect only ever needs to fire once per mount.
	// `announcedDecision` guards it anyway, defensively, against Svelte
	// re-running the effect within that one mount; it is not standing in
	// for a client-side fetch this file does not make.
	let announcedDecision: string | null = null;
	$effect(() => {
		if (!form?.decided) return;
		const key = `${data.proposal.id}:${form.action}`;
		if (announcedDecision === key) return;
		announcedDecision = key;
		if (form.action === 'accept') {
			toasts.push('success', m.proposal_review_accept_toast());
		} else if (form.action === 'reject') {
			toasts.push('neutral', m.proposal_reject_toast());
		}
	});

	// Rejecting asks first: the Reject button opens this instead of
	// submitting directly, and the dialog's own Reject button — inside the
	// same <form> — is what actually submits `?/reject` (#207). A plain UI
	// toggle, unaffected by a background `invalidateAll()` the same way
	// every other dialog-open flag on this route is.
	let rejectDialogOpen = $state(false);

	// One form, two possible actions (default submit = accept, the reject
	// dialog's own submit carries `formaction="?/reject"`) — `submitting()`
	// alone can only say "a submission is in flight", not which of the two
	// buttons it belongs to, so `pressedAction` (read off `event.submitter`,
	// the only reliable way to know which button actually triggered this
	// particular submit) carries that half locally. Only one of the three
	// `<form>` branches below is ever mounted at a time (mutually exclusive
	// on `data.proposal.targetType`/`pending`), so one shared instance is
	// correct rather than one per branch.
	const decision = submitting();
	let pressedAction = $state<'accept' | 'reject'>('accept');

	function onDecisionSubmit(event: SubmitEvent) {
		const submitter = event.submitter as HTMLButtonElement | null;
		pressedAction = submitter?.getAttribute('formaction') === '?/reject' ? 'reject' : 'accept';
		decision.onsubmit();
	}
</script>

{#snippet rejectDialog()}
	<Dialog bind:open={rejectDialogOpen} title={m.proposal_reject_confirm_title()} role="alertdialog">
		<p>{m.proposal_reject_confirm_body()}</p>
		{#snippet actions()}
			<Button type="button" variant="tertiary" onclick={() => (rejectDialogOpen = false)}>
				{m.proposal_reject_confirm_cancel()}
			</Button>
			<Button
				type="submit"
				formaction="?/reject"
				variant="danger"
				disabled={decision.busy && pressedAction !== 'reject'}
				loading={decision.busy && pressedAction === 'reject'}
			>
				{m.proposal_reject_confirm_confirm()}
			</Button>
		{/snippet}
	</Dialog>
{/snippet}

{#snippet decisionActions()}
	{#if form?.decisionError}
		<p class="decision-error" role="alert">
			{form.decisionError}
		</p>
	{/if}
	{#if acceptBlockedReason}
		<p class="blocked-reason" role="status">{acceptBlockedReason}</p>
	{/if}
	<div class="submit-stack">
		<Button
			type="submit"
			variant="primary"
			disabled={acceptBlocked || (decision.busy && pressedAction !== 'accept')}
			loading={decision.busy && pressedAction === 'accept'}
		>
			{acceptSubmitLabel}
		</Button>
		<Button type="button" variant="danger" onclick={() => (rejectDialogOpen = true)}>
			{m.proposal_detail_reject_submit()}
		</Button>
		<Button href={resolve('/proposals')} variant="tertiary">
			{m.proposal_review_skip()}
		</Button>
	</div>
	{@render rejectDialog()}
{/snippet}

{#snippet rateCardsEmpty()}
	<p class="muted">{m.rate_card_empty()}</p>
{/snippet}

{#snippet newClientFields(candidate: ExtractedContractCandidate)}
	<fieldset class="card">
		<legend><h2>{m.client_form_legal_identity_legend()}</h2></legend>
		<p class="hint">{m.proposal_contract_client_hint()}</p>
		<Field label={m.client_form_legal_name_label()}>
			<Input
				name="client.legalName"
				value={candidate.client.legalName}
				disabled={!pending}
				oninput={() => markEdited('legalName')}
			/>
		</Field>
		<Field label={m.client_form_country_label()}>
			<Select name="client.country" value={candidate.client.country} disabled={!pending}>
				{#each countries as country (country.code)}
					<option value={country.code} selected={candidate.client.country === country.code}>
						{country.name}
					</option>
				{/each}
			</Select>
		</Field>
		<div class="grid-2">
			<Field label={m.client_form_tax_id_label()}>
				<Input name="client.taxId" value={candidate.client.taxId ?? ''} disabled={!pending} />
			</Field>
			<Field label={m.client_form_vat_id_label()}>
				<Input name="client.vatId" value={candidate.client.vatId ?? ''} disabled={!pending} />
			</Field>
		</div>
	</fieldset>

	<fieldset class="card">
		<legend><h2>{m.client_form_address_legend()}</h2></legend>
		<Field label={m.client_form_address_line1_label()}>
			<Input
				name="client.addressLine1"
				value={candidate.client.addressLine1 ?? ''}
				disabled={!pending}
			/>
		</Field>
		<Field label={m.client_form_address_line2_label()}>
			<Input
				name="client.addressLine2"
				value={candidate.client.addressLine2 ?? ''}
				disabled={!pending}
			/>
		</Field>
		<div class="grid-2">
			<Field label={m.client_form_city_label()}>
				<Input
					name="client.addressCity"
					value={candidate.client.addressCity ?? ''}
					disabled={!pending}
				/>
			</Field>
			<Field label={m.client_form_postal_code_label()}>
				<Input
					name="client.addressPostalCode"
					value={candidate.client.addressPostalCode ?? ''}
					disabled={!pending}
				/>
			</Field>
		</div>
		<Field label={m.client_form_region_label()}>
			<Input
				name="client.addressRegion"
				value={candidate.client.addressRegion ?? ''}
				disabled={!pending}
			/>
		</Field>
	</fieldset>
{/snippet}

<svelte:head><title>{m.proposal_detail_page_title()}</title></svelte:head>

<Page
	crumbs={data.crumbs}
	title={pageHeading}
	subtitle={factLine([data.contract?.title, data.contract?.clientLegalName])}
	width={formMajor ? 'wide' : 'text'}
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

	<div class="layout" class:form-major={formMajor}>
		<!-- Evidence. Major column for a work_unit proposal, minor and
		     sticky for a contract one, whose form is the taller half. -->
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
				{#if data.message.subject !== null || data.message.from}
					<dt>{m.proposal_evidence_subject_label()}</dt>
					<dd>{data.message.subject ?? m.proposal_queue_no_subject()}</dd>
				{/if}
			</dl>

			{#if messageSplit}
				<p class="message-body">
					{messageSplit.before}<mark>{messageSplit.match}</mark>{messageSplit.after}
				</p>
				<p class="hint">{m.proposal_evidence_excerpt_hint()}</p>
			{:else}
				{#if data.message.body}
					<p class="message-body">{data.message.body}</p>
				{/if}
				<div>
					<h3>{m.proposal_detail_excerpt_heading()}</h3>
					<blockquote>{data.proposal.excerpt}</blockquote>
				</div>
			{/if}

			<div class="sep"></div>
			<SourceDocument document={data.sourceDocument} />
			<p class="hint">{m.proposal_evidence_document_hint()}</p>
		</div>

		<!-- Proposed fields. Minor column for a work_unit proposal, major
		     for a contract one. -->
		<div class="fields">
			{#if data.proposal.targetType === 'contract' && data.contractCandidate}
				{@const candidate = data.contractCandidate}
				<form method="POST" action="?/accept" class="fields-form" onsubmit={onDecisionSubmit}>
					{#if pending}
						<fieldset class="card">
							<legend><h2>{m.proposal_contract_client_mode_legend()}</h2></legend>
							<div
								class="client-mode"
								role="radiogroup"
								aria-label={m.proposal_contract_client_mode_legend()}
							>
								<Radio
									name="clientMode"
									value="existing"
									label={m.proposal_contract_client_mode_existing_label()}
									bind:group={clientMode}
								/>
								<Radio
									name="clientMode"
									value="new"
									label={m.proposal_contract_client_mode_new_label()}
									bind:group={clientMode}
								/>
							</div>

							{#if clientMode === 'existing'}
								<Field label={m.proposal_contract_client_picker_label()}>
									<Select name="clientId" bind:value={selectedClientId}>
										<option value="" selected={selectedClientId === ''}>
											{m.proposal_contract_client_picker_placeholder()}
										</option>
										{#each data.existingClients as row (row.id)}
											<option value={row.id} selected={selectedClientId === row.id}>
												{row.taxId ? `${row.legalName} (${row.taxId})` : row.legalName}
											</option>
										{/each}
									</Select>
								</Field>
								{#if data.existingClients.length === 0}
									<p class="hint">{m.proposal_contract_client_picker_empty_option()}</p>
								{:else if data.clientMatchId && selectedClientId === data.clientMatchId}
									<p class="hint">{m.proposal_contract_client_match_hint()}</p>
								{/if}

								{#if selectedClient}
									{@const linkedClient = selectedClient}
									{@const diffs = clientDiffs(candidate.client)}
									{#if diffs.length === 0}
										<p class="hint">{m.proposal_contract_client_diff_none()}</p>
									{:else}
										<div class="client-diff">
											<p class="readings-legend">{m.proposal_contract_client_diff_heading()}</p>
											{#each diffs as { key, label } (key)}
												<div class="client-diff-row">
													<span class="client-diff-field">{label()}</span>
													<dl class="pairs">
														<dt>{m.proposal_contract_client_diff_on_file_label()}</dt>
														<dd>{linkedClient[key] ?? m.client_detail_not_set()}</dd>
														<dt>{m.proposal_contract_client_diff_from_document_label()}</dt>
														<dd>{candidate.client[key] ?? m.client_detail_not_set()}</dd>
													</dl>
													<Checkbox
														name={`clientFieldAdopt.${key}`}
														label={m.proposal_contract_client_diff_adopt_label()}
														checked={false}
													/>
												</div>
											{/each}
										</div>
									{/if}
								{/if}
							{/if}
						</fieldset>
					{/if}

					{#if !pending || clientMode === 'new'}
						{@render newClientFields(candidate)}
					{/if}
					<fieldset class="card">
						<legend><h2>{m.contract_form_identity_legend()}</h2></legend>
						<Field label={m.contract_form_title_label()}>
							<Input
								name="title"
								value={candidate.contract.title}
								disabled={!pending}
								oninput={() => markEdited('title')}
							/>
						</Field>
						<Field label={m.contract_form_signed_document_reference_label()}>
							<Input
								name="signedDocumentReference"
								value={candidate.contract.signedDocumentReference ?? ''}
								disabled={!pending}
							/>
						</Field>
						<div class="grid-2">
							<Field label={m.contract_form_starts_on_label()} error={fieldError('startsOn')}>
								<Input
									type="date"
									name="startsOn"
									value={candidate.contract.startsOn}
									disabled={!pending}
									oninput={() => markEdited('startsOn')}
								/>
							</Field>
							<Field label={m.contract_form_ends_on_label()} error={fieldError('endsOn')}>
								<Input
									type="date"
									name="endsOn"
									value={candidate.contract.endsOn ?? ''}
									disabled={!pending}
									oninput={() => markEdited('endsOn')}
								/>
							</Field>
						</div>
					</fieldset>

					<fieldset class="card">
						<legend><h2>{m.contract_form_payment_legend()}</h2></legend>
						<div class="grid-2">
							<Field
								label={m.contract_form_payment_terms_kind_label()}
								error={fieldError('paymentTerms')}
							>
								<Select
									name="paymentTermsKind"
									bind:value={paymentTermsKind}
									disabled={!pending}
									oninput={() => markEdited('paymentTerms')}
								>
									<option value="" selected={paymentTermsKind === ''}>
										{m.proposal_contract_field_unresolved_placeholder()}
									</option>
									{#each paymentTermsKinds as kind (kind)}
										<option value={kind} selected={paymentTermsKind === kind}>
											{paymentTermsKindLabel(kind)}
										</option>
									{/each}
								</Select>
							</Field>
							{#if paymentTermsKind === 'net'}
								<Field label={m.contract_form_payment_terms_net_days_label()}>
									<Input
										type="number"
										min="1"
										step="1"
										numeric
										name="paymentTermsNetDays"
										value={candidate.contract.paymentTerms?.kind === 'net'
											? candidate.contract.paymentTerms.days
											: ''}
										disabled={!pending}
										oninput={() => markEdited('paymentTerms')}
									/>
								</Field>
							{:else if paymentTermsKind === 'day_of_month'}
								<Field
									label={m.contract_form_payment_terms_day_of_month_label()}
									hint={m.contract_form_payment_terms_day_of_month_hint()}
								>
									<Input
										type="number"
										min="1"
										max="31"
										step="1"
										numeric
										name="paymentTermsDayOfMonthDay"
										value={candidate.contract.paymentTerms?.kind === 'day_of_month'
											? candidate.contract.paymentTerms.day
											: ''}
										disabled={!pending}
										oninput={() => markEdited('paymentTerms')}
									/>
								</Field>
							{/if}
						</div>
						<div class="grid-2">
							<Field label={m.contract_form_invoicing_cadence_label()}>
								<Select
									name="invoicingCadence"
									value={candidate.contract.invoicingCadence}
									disabled={!pending}
								>
									{#each invoicingCadences as cadence (cadence)}
										<option
											value={cadence}
											selected={candidate.contract.invoicingCadence === cadence}
										>
											{invoicingCadenceLabel(cadence)}
										</option>
									{/each}
								</Select>
							</Field>
							<Field label={m.contract_form_currency_label()} error={fieldError('currency')}>
								<Input
									name="currency"
									bind:value={currency}
									maxlength={3}
									style="text-transform: uppercase"
									disabled={!pending}
									oninput={() => markEdited('currency')}
								/>
							</Field>
						</div>
						<Field
							label={m.contract_form_tax_treatment_label()}
							hint={m.contract_form_tax_treatment_hint()}
							error={fieldError('taxTreatment')}
						>
							<Input
								name="taxTreatment"
								value={candidate.contract.taxTreatment ?? ''}
								disabled={!pending}
								oninput={() => markEdited('taxTreatment')}
							/>
						</Field>
					</fieldset>

					<fieldset class="card">
						<legend><h2>{m.contract_form_renewal_legend()}</h2></legend>
						<Field label={m.contract_form_renewal_type_label()} error={fieldError('renewalType')}>
							<Select
								name="renewalType"
								bind:value={renewalType}
								disabled={!pending}
								oninput={() => markEdited('renewalType')}
							>
								<option value="" selected={renewalType === ''}>
									{m.proposal_contract_field_unresolved_placeholder()}
								</option>
								{#each contractRenewalTypes as type (type)}
									<option value={type} selected={renewalType === type}>
										{renewalTypeLabel(type)}
									</option>
								{/each}
							</Select>
						</Field>
						{#if renewalType !== '' && renewalType !== 'none'}
							<Field
								label={m.contract_form_renewal_notice_days_label()}
								error={fieldError('renewalNoticeDays')}
							>
								<Input
									type="number"
									min="0"
									step="1"
									numeric
									name="renewalNoticeDays"
									value={candidate.contract.renewalNoticeDays ?? ''}
									disabled={!pending}
									oninput={() => markEdited('renewalNoticeDays')}
								/>
							</Field>
						{/if}
						<Field
							label={m.contract_form_termination_notice_days_label()}
							error={fieldError('terminationNoticeDays')}
						>
							<Input
								type="number"
								min="0"
								step="1"
								numeric
								name="terminationNoticeDays"
								value={candidate.contract.terminationNoticeDays}
								disabled={!pending}
								oninput={() => markEdited('terminationNoticeDays')}
							/>
						</Field>
					</fieldset>

					<fieldset class="card">
						<legend><h2>{m.contract_form_expenses_legend()}</h2></legend>
						<Field
							label={m.contract_form_expense_policy_kind_label()}
							error={fieldError('expensePolicy')}
						>
							<Select
								name="expensePolicyKind"
								bind:value={expensePolicyKind}
								disabled={!pending}
								oninput={() => markEdited('expensePolicy')}
							>
								<option value="" selected={expensePolicyKind === ''}>
									{m.proposal_contract_field_unresolved_placeholder()}
								</option>
								{#each expensePolicyKinds as kind (kind)}
									<option value={kind} selected={expensePolicyKind === kind}>
										{expensePolicyKindLabel(kind)}
									</option>
								{/each}
							</Select>
						</Field>
						{#if expensePolicyKind === 'reimbursed_with_cap'}
							<AmountInput
								label={m.contract_form_expense_policy_cap_amount_label()}
								name="expensePolicyCapAmount"
								value={expensePolicyCapValue}
								{currency}
								disabled={!pending}
							/>
						{/if}
						{#if expensePolicyKind !== '' && expensePolicyKind !== 'not_reimbursed'}
							<Checkbox
								name="requiresExpensePreAuthorisation"
								checked={candidate.contract.requiresExpensePreAuthorisation}
								label={m.contract_form_requires_expense_pre_authorisation_label()}
								disabled={!pending}
							/>
						{/if}
						<Checkbox
							name="requiresPriorApproval"
							checked={candidate.contract.requiresPriorApproval}
							label={m.contract_form_requires_prior_approval_label()}
							disabled={!pending}
						/>
					</fieldset>

					<div class="card">
						<div class="card-head"><h2>{m.rate_card_section_heading()}</h2></div>
						<Table
							columns={rateCardColumns}
							rows={candidate.rateCards}
							caption={m.rate_card_section_heading()}
							rowKey={(row) => `${row.validFrom}-${row.kind}-${row.amount}-${row.unit}`}
							empty={rateCardsEmpty}
						/>
					</div>

					<div class="card">
						<div class="card-head"><h2>{m.proposal_contract_clauses_heading()}</h2></div>
						{#if candidate.clauseFlags.length === 0}
							<p class="muted">{m.clause_note_empty()}</p>
						{:else}
							{#each candidate.clauseFlags as flag, i (flag.clauseReference ?? i)}
								<div class="clause-flag">
									<div class="clause-flag-head">
										<Badge variant="warning" label={flag.clauseReference ?? ''} size="sm" />
										<span class="hint"
											>{m.proposal_contract_clause_affects({ field: flag.field })}</span
										>
									</div>
									<div>
										<span class="hint">{m.clause_note_form_verbatim_text_label()}</span>
										<blockquote>{flag.verbatimText}</blockquote>
									</div>
									<div
										class="readings"
										role="radiogroup"
										aria-label={m.proposal_contract_clause_reading_legend()}
									>
										<p class="readings-legend">{m.proposal_contract_clause_reading_legend()}</p>
										<p class="hint">{m.proposal_contract_clause_reading_hint()}</p>
										{#each flag.readings as reading (reading)}
											<Radio
												name="clauseFlags.{i}.interpretationAdopted"
												value={reading}
												label={reading}
												bind:group={clauseReadings[i]}
												disabled={!pending}
											/>
										{/each}
										{#if pending && !clauseReadings[i]}
											<p class="err" role="alert">
												{m.proposal_contract_clause_reading_required_error()}
											</p>
										{/if}
									</div>
								</div>
							{/each}
						{/if}
					</div>

					{#if pending && data.proposal.confidenceReason}
						<Banner tone="warning">
							<strong>{confidence.label} ({formatPercent(data.proposal.confidence)})</strong>: {data
								.proposal.confidenceReason}
						</Banner>
					{/if}
					{#if validationMessage}
						<Banner tone="critical">
							<strong>{m.proposal_validation_banner_heading()}</strong>
							{validationMessage}
						</Banner>
					{/if}

					{#if pending}
						<!-- Pinned to the bottom of the viewport for the whole scroll
						     of the form: the decision used to sit under 3050px of
						     fieldsets, so a reviewer met the disabled Accept only
						     after scrolling past everything twice (#280). -->
						<div class="actions-bar">
							{@render decisionActions()}
						</div>
					{:else if data.proposal.status === 'accepted' && data.proposal.resultId && data.acceptedContractClientId}
						<Button
							href={resolve('/clients/[id]/contracts/[contractId]', {
								id: data.acceptedContractClientId,
								contractId: data.proposal.resultId
							})}
							variant="primary"
						>
							{m.proposal_detail_result_link_contract()}
						</Button>
					{/if}
				</form>
			{:else if data.proposal.targetType === 'invoice' && data.invoiceFields}
				{@const invoice = data.invoiceFields}
				<div class="card fields-form">
					<div class="card-head"><h2>{m.proposal_invoice_heading()}</h2></div>
					<dl class="pairs">
						<dt>{m.invoice_form_number_label()}</dt>
						<dd>{invoice.number}</dd>
						<dt>{m.invoice_form_issue_date_label()}</dt>
						<dd>{formatDate(invoice.issueDate)}</dd>
						{#if invoice.dueDate}
							<dt>{m.invoice_detail_due_date_label()}</dt>
							<dd>{formatDate(invoice.dueDate)}</dd>
						{/if}
						<dt>{m.proposal_invoice_client_label()}</dt>
						<dd>{invoice.clientName}</dd>
					</dl>

					<div class="lines-scroll">
						<table class="lines">
							<caption class="sr-only"
								>{m.invoice_detail_lines_heading()} — {invoice.number}</caption
							>
							<thead>
								<tr>
									<th scope="col">{m.invoice_form_line_description_label()}</th>
									<th scope="col" class="num">{m.invoice_form_line_quantity_label()}</th>
									<th scope="col" class="num">{m.invoice_form_line_unit_price_label()}</th>
									<th scope="col" class="num">{m.invoice_form_line_amount_label()}</th>
								</tr>
							</thead>
							<tbody>
								{#each invoice.lines as line, i (i)}
									<tr>
										<td>{line.description}</td>
										<td class="num">{formatNumber(line.quantity)}</td>
										<td class="num">
											<Amount minorUnits={line.unitPrice} currency={invoice.currency} size="md" />
										</td>
										<td class="num">
											<Amount minorUnits={line.amount} currency={invoice.currency} size="md" />
										</td>
									</tr>
								{/each}
							</tbody>
							<tfoot>
								<tr>
									<td colspan="3">{m.invoice_detail_taxable_amount_label()}</td>
									<td class="num">
										<Amount
											minorUnits={invoice.taxableAmount}
											currency={invoice.currency}
											size="md"
										/>
									</td>
								</tr>
								<tr>
									<td colspan="3">{m.invoice_detail_tax_amount_label()}</td>
									<td class="num">
										<Amount minorUnits={invoice.taxAmount} currency={invoice.currency} size="md" />
									</td>
								</tr>
								<tr class="total-row">
									<td colspan="3">{m.invoice_detail_total_label()}</td>
									<td class="num">
										<Amount minorUnits={invoice.total} currency={invoice.currency} size="md" />
									</td>
								</tr>
							</tfoot>
						</table>
					</div>

					{#if pending && data.proposal.confidenceReason}
						<Banner tone="warning">
							<strong>{confidence.label} ({formatPercent(data.proposal.confidence)})</strong>: {data
								.proposal.confidenceReason}
						</Banner>
					{/if}
					{#if validationMessage}
						<Banner tone="critical">
							<strong>{m.proposal_validation_banner_heading()}</strong>
							{validationMessage}
						</Banner>
					{/if}

					{#if pending}
						<form method="POST" action="?/accept" onsubmit={onDecisionSubmit}>
							{@render decisionActions()}
						</form>
					{:else if data.proposal.status === 'accepted' && data.proposal.resultId}
						<Button
							href={resolve('/invoices/[id]', { id: data.proposal.resultId })}
							variant="primary"
						>
							{m.proposal_detail_result_link_invoice()}
						</Button>
					{/if}
				</div>
			{:else if pending}
				<form method="POST" action="?/accept" class="card fields-form" onsubmit={onDecisionSubmit}>
					{#each fieldEntries as [field, value] (field)}
						{@const grounded = isFieldGroundedInExcerpt(value, data.proposal.excerpt)}
						<Field
							label={proposalFieldLabel(field)}
							hint={grounded
								? m.proposal_field_hint_grounded()
								: m.proposal_field_hint_not_grounded()}
							error={fieldError(field)}
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

					{#if validationMessage}
						<Banner tone="critical">
							<strong>{m.proposal_validation_banner_heading()}</strong>
							{validationMessage}
						</Banner>
					{/if}

					{@render decisionActions()}
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

			{#if data.proposal.status === 'accepted' && data.proposal.targetType === 'work_unit'}
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
	/* Flex, not a grid with a fixed fr ratio, and no viewport breakpoint:
	   the thing that decides whether two columns fit is the width of the
	   content area, which the sidebar and the page's own max-width both
	   shrink well below the window (#280). Each column declares the width
	   it needs to be usable and `flex-wrap` stacks them the moment both no
	   longer fit, whatever the viewport is doing. */
	.layout {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-5);
		margin-top: var(--space-5);
		align-items: flex-start;
		container-type: inline-size;
	}
	.evidence {
		flex: 2 1 20rem;
		min-width: 0;
	}
	.fields {
		flex: 1 1 14rem;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	/* A contract proposal inverts the weighting: the form is what the
	   reviewer works in, so it takes the space and the evidence follows
	   the scroll instead of leaving the screen after the first fieldset.
	   Both keep `flex-grow`, because grow is per flex line: sharing a line
	   the 1:100 ratio leaves the evidence at its 20rem basis and hands the
	   rest to the form, and alone on a wrapped line either one fills the
	   row instead of sitting at 320px against a 700px page. */
	.form-major .evidence {
		flex: 1 1 20rem;
	}
	.form-major .fields {
		flex: 100 1 32rem;
	}
	/* Sticky only while the evidence is genuinely beside the form. Once
	   the two wrap, the evidence sits above it, and a sticky panel there
	   would pin to the top and cover the fields being filled in. The
	   threshold is the width both flex bases plus the gap need, said once
	   — and asked of the layout's own box, since the window is not what
	   ran out of room (#280). `max-height` plus its own scroll, because a
	   mail-sourced contract's body can be longer than the window and a
	   sticky panel taller than the viewport never settles. */
	@container (min-width: 53.5rem) {
		.form-major .evidence {
			position: sticky;
			top: var(--space-4);
			max-height: calc(100vh - 2 * var(--space-4));
			overflow-y: auto;
		}
	}
	.card {
		border: 1px solid var(--border-hairline);
		border-radius: var(--radius-md);
		background: var(--surface-1);
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		margin: 0;
		min-width: 0;
	}
	.card > legend {
		padding: 0;
		width: 100%;
	}
	.card-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}
	.card-head h2,
	.card > legend h2 {
		margin: 0;
		font-size: var(--text-lg);
		font-weight: var(--weight-medium);
		color: var(--text-primary);
	}
	/* Self-collapsing: `auto-fit` drops to one column when the card it
	   sits in is narrower than two usable fields, without anyone asking
	   the viewport — the `@media (max-width: 639px)` this replaces was
	   querying the window while the narrow box was the column, so a
	   271px column on a 1280px screen kept two 110px inputs (#280). */
	.grid-2 {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
		gap: var(--space-4);
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
	.fields-form {
		align-self: start;
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.actions-bar {
		position: sticky;
		bottom: var(--space-4);
		z-index: 1;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--border-hairline);
		border-radius: var(--radius-md);
		background: var(--surface-1);
		box-shadow: var(--shadow-overlay);
	}
	.actions-bar .submit-stack {
		flex-direction: row;
		flex-wrap: wrap;
		justify-content: flex-end;
	}
	.blocked-reason {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-secondary);
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
	.clause-flag {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3);
		border: 1px solid var(--border-hairline);
		border-radius: var(--radius-sm);
	}
	.clause-flag-head {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.readings {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.readings-legend {
		margin: 0;
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		color: var(--text-primary);
	}
	.client-mode {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.client-diff {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.client-diff-row {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-2);
		border: 1px solid var(--border-hairline);
		border-radius: var(--radius-sm);
	}
	.client-diff-field {
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		color: var(--text-primary);
	}
	.err {
		margin: 0;
		font-size: var(--text-xs);
		color: var(--color-danger);
		font-weight: var(--weight-medium);
	}
	.lines-scroll {
		overflow-x: auto;
	}
	table.lines {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--text-sm);
	}
	table.lines th,
	table.lines td {
		padding: var(--space-2) var(--space-3);
		text-align: left;
		border-bottom: 1px solid var(--border-hairline);
	}
	table.lines th.num,
	table.lines td.num {
		text-align: right;
	}
	table.lines tfoot td {
		border-bottom: none;
		border-top: 1px solid var(--border-hairline);
	}
	table.lines .total-row td {
		font-weight: var(--weight-medium);
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
</style>
