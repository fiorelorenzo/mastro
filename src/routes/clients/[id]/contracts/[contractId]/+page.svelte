<!--
	The contract's own page (#240): what it has produced, what is owed on
	it, and what was agreed — answerable here, without leaving. It used to
	be five definition lists of column names and showed neither a day nor
	an invoice, the two things a contract actually produces. Recomposed
	around production, following `docs/specs/ux-review/mockups/
	40-contract.html` (direction B2): a stat strip, the renewal window as
	a banner when it is genuinely due, the days and invoices this contract
	produced, its rate cards with the one in force today marked, its
	expenses with an inline rebill, its interpreted clauses as quoted
	evidence, and everything else — payment, renewal, notice, expenses
	policy, fiscal, mail — collapsed into one block of prose at the
	bottom. Approvals (#210) and Documents (#215), wave 2's additions,
	stay: approvals next to the days they cover, documents (contract-level
	ones the mail hub never claimed) next to the clauses, both evidence
	for a dispute the same way.
-->
<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import {
		formatAmount,
		formatDate,
		formatDateTime,
		formatDays,
		formatMinorUnits,
		formatNumber
	} from '$lib/i18n/format';
	import { Amount, Badge, Banner, Button, EmptyState, Select, StatTile } from '$lib/design';
	import SourceDocument from '$lib/design/SourceDocument.svelte';
	import Table from '$lib/design/Table.svelte';
	import type { TableColumn } from '$lib/design/table';
	import { workUnitStateBadge, type WorkUnitStateValue } from '$lib/design/day-state-badge';
	import Card from '$lib/layout/Card.svelte';
	import Page from '$lib/layout/Page.svelte';
	import Section from '$lib/layout/Section.svelte';
	import { invoiceStatus } from '../../../../invoices/status';
	import {
		expensePolicyKindLabel,
		invoicingCadenceLabel,
		paymentTermsKindLabel,
		renewalTypeLabel,
		statusLabel
	} from '../contract-enums';
	import {
		disbursementPeriodLabel,
		rateCardKindLabel,
		rateUnitLabel
	} from './rate-cards/rate-card-enums';
	import { noticeChannelLabel, type NoticeChannelValue } from '../../../notice-channel';
	import type { ActionData, PageData, PageProps } from './$types';

	let { data, form }: PageProps & { form: ActionData } = $props();

	const contract = $derived(data.contract);
	const subtitle = $derived(
		[formatDate(contract.startsOn), renewalTypeLabel(contract.renewalType)].join(' · ')
	);

	type DayRow = PageData['days'][number];
	type InvoiceRow = PageData['invoices'][number];
	type RateCardRow = PageData['rateCards'][number];
	type ExpenseRow = PageData['expenses'][number];
	type ApprovalRow = PageData['approvals'][number];

	// A language names itself — the same choice `mail/contracts/[id]`
	// already made for the same field, so this page's "Template language"
	// row reads "Italiano"/"English" instead of a raw locale tag.
	function autonym(locale: string): string {
		return new Intl.DisplayNames([locale], { type: 'language' }).of(locale) ?? locale;
	}

	// Payment terms, expense policy and renewal notice each collapse two
	// database columns (a kind plus its parameter) into one line — the
	// terms block reads as an agreement, not a schema.
	const paymentTermsValue = $derived(
		contract.paymentTerms.kind === 'net'
			? `${paymentTermsKindLabel('net')} (${formatNumber(contract.paymentTerms.days)})`
			: `${paymentTermsKindLabel('day_of_month')} (${formatNumber(contract.paymentTerms.day)})`
	);
	const expensePolicyValue = $derived(
		contract.expensePolicy.kind === 'reimbursed_with_cap'
			? `${expensePolicyKindLabel('reimbursed_with_cap')} (${formatNumber(contract.expensePolicy.capAmount / 100)} ${contract.currency})`
			: expensePolicyKindLabel(contract.expensePolicy.kind)
	);
	const renewalNoticeValue = $derived(
		contract.renewalNoticeDays === null
			? null
			: data.renewalWindowOpensOn
				? m.contract_detail_terms_renewal_notice_with_window({
						days: formatDays(contract.renewalNoticeDays),
						windowDate: formatDate(data.renewalWindowOpensOn)
					})
				: formatDays(contract.renewalNoticeDays)
	);

	const termsRows = $derived([
		{ dt: m.contract_form_payment_terms_kind_label(), dd: paymentTermsValue },
		{
			dt: m.contract_form_invoicing_cadence_label(),
			dd: invoicingCadenceLabel(contract.invoicingCadence)
		},
		{ dt: m.contract_form_currency_label(), dd: contract.currency },
		{ dt: m.contract_detail_terms_tax_treatment_label(), dd: contract.taxTreatment },
		{ dt: m.contract_form_starts_on_label(), dd: formatDate(contract.startsOn) },
		{
			dt: m.contract_form_ends_on_label(),
			dd: contract.endsOn ? formatDate(contract.endsOn) : m.contract_ends_on_open()
		},
		{ dt: m.contract_form_renewal_type_label(), dd: renewalTypeLabel(contract.renewalType) },
		...(renewalNoticeValue !== null
			? [{ dt: m.contract_detail_terms_renewal_notice_label(), dd: renewalNoticeValue }]
			: []),
		{
			dt: m.contract_detail_terms_termination_notice_label(),
			dd: formatDays(contract.terminationNoticeDays)
		},
		{ dt: m.contract_form_expense_policy_kind_label(), dd: expensePolicyValue },
		{
			dt: m.contract_detail_terms_expense_preauth_label(),
			dd: contract.requiresExpensePreAuthorisation
				? m.contract_detail_terms_expense_preauth_required()
				: m.contract_detail_terms_expense_preauth_not_required()
		},
		{
			dt: m.contract_detail_terms_prior_approval_label(),
			dd: contract.requiresPriorApproval
				? m.contract_detail_terms_prior_approval_required()
				: m.contract_form_requires_prior_approval_not_required_option()
		},
		{
			dt: m.contract_detail_terms_mail_folder_label(),
			dd: contract.mailFolder ?? m.contract_detail_terms_mail_folder_none()
		},
		{
			dt: m.mail_contract_template_language_legend(),
			dd: autonym(contract.templateLanguage)
		},
		...(contract.signedDocumentReference
			? [
					{
						dt: m.contract_form_signed_document_reference_label(),
						dd: contract.signedDocumentReference
					}
				]
			: [])
	] satisfies readonly { dt: string; dd: string }[]);

	const daysThisYearLabel = $derived(formatNumber(data.stats.daysThisYear));
	const outstandingSub = $derived(
		data.stats.outstandingCount === 0
			? m.contract_detail_stat_outstanding_sub_none()
			: m.contract_detail_stat_outstanding_sub_count({ count: data.stats.outstandingCount })
	);
	const collectedSub = $derived(
		data.stats.collectedCount === 0
			? m.contract_detail_stat_collected_sub_none()
			: data.stats.collectedInvoiceNumber !== null
				? m.contract_detail_stat_collected_sub_invoice({
						number: data.stats.collectedInvoiceNumber
					})
				: m.contract_detail_stat_collected_sub_count({ count: data.stats.collectedCount })
	);
	const inForceRateCard = $derived(
		data.rateCards.find((card) => card.id === data.inForceRateCardId) ?? null
	);

	// The one row action `Table` cannot express as a plain cell: rebilling
	// posts a form with an invoice-line picker, rendered inline in the
	// row it applies to (reimbursable, not yet rebilled, and there is
	// somewhere to rebill it onto) instead of a duplicated row underneath.
	function canRebill(row: ExpenseRow): boolean {
		return row.reimbursable && !row.invoiceLineId && data.invoiceLines.length > 0;
	}
</script>

<svelte:head><title>{m.contract_detail_page_title({ title: contract.title })}</title></svelte:head>

{#snippet dayDateCell(row: DayRow)}
	<span class="stack">
		<span>{formatDate(row.date)}</span>
		{#if row.notes}<span class="hint">{row.notes}</span>{/if}
	</span>
{/snippet}
{#snippet dayStateCell(row: DayRow)}
	{@const badge = workUnitStateBadge(row.state as WorkUnitStateValue)}
	<Badge variant={badge.variant} label={badge.label} size="sm" />
{/snippet}
{#snippet dayAmountCell(row: DayRow)}
	{#if row.amount !== null}
		<Amount minorUnits={row.amount} currency={contract.currency} size="md" />
	{:else}
		<span class="unpriced">—</span>
	{/if}
{/snippet}
{#snippet daysEmpty()}
	<EmptyState
		icon="▦"
		title={m.contract_detail_empty_title()}
		body={m.contract_detail_days_empty()}
	/>
{/snippet}
{#snippet approvalReceivedCell(row: ApprovalRow)}
	{formatDateTime(row.receivedAt)}
{/snippet}
{#snippet approvalsEmpty()}
	<EmptyState icon="✉" title={m.contract_detail_empty_title()} body={m.contract_approval_empty()} />
{/snippet}
{#snippet invoiceStatusCell(row: InvoiceRow)}
	{@const status = invoiceStatus(row.daysLate ?? 0, row.paidOn)}
	<span class="stack">
		<Badge variant={status.level} label={status.label} size="sm" />
		{#if row.paidOn}<span class="hint">{formatDate(row.paidOn)}</span>{/if}
	</span>
{/snippet}
{#snippet invoiceTotalCell(row: InvoiceRow)}
	<Amount minorUnits={row.total} currency={row.currency} size="md" />
{/snippet}
{#snippet invoicesEmpty()}
	<EmptyState
		icon="€"
		title={m.contract_detail_empty_title()}
		body={m.contract_detail_invoices_empty()}
	/>
{/snippet}
{#snippet rateCardValidityCell(row: RateCardRow)}
	{formatDate(row.validFrom)} – {row.validTo
		? formatDate(row.validTo)
		: m.rate_card_valid_to_open()}
{/snippet}
{#snippet rateCardInForceCell(row: RateCardRow)}
	{#if row.id === data.inForceRateCardId}
		<Badge variant="info" label={m.contract_detail_rate_card_in_force()} size="sm" />
	{/if}
{/snippet}
{#snippet rateCardsEmpty()}
	<EmptyState icon="◇" title={m.contract_detail_empty_title()} body={m.rate_card_empty()} />
{/snippet}
{#snippet expenseStatusCell(row: ExpenseRow)}
	{#if row.invoiceLineId}
		<Badge variant="good" label={m.expense_rebilled_yes()} size="sm" />
	{:else if !row.reimbursable}
		<Badge variant="neutral" label={m.expense_non_reimbursable_label()} size="sm" />
	{:else}
		<Badge variant="warning" label={m.expense_rebilled_no()} size="sm" />
	{/if}
{/snippet}
{#snippet expenseAmountCell(row: ExpenseRow)}
	<Amount minorUnits={row.amount} currency={contract.currency} size="md" />
{/snippet}
{#snippet expenseRebillCell(row: ExpenseRow)}
	{#if canRebill(row)}
		<form method="POST" action="?/rebill" class="rebill-form">
			<input type="hidden" name="expenseId" value={row.id} />
			<Select name="invoiceLineId" size="md" aria-label={m.expense_rebill_placeholder()} required>
				<option value="" disabled selected>{m.expense_rebill_placeholder()}</option>
				{#each data.invoiceLines as line (line.id)}
					<option value={line.id}>{line.invoiceNumber} — {line.description}</option>
				{/each}
			</Select>
			<Button type="submit" variant="secondary" size="sm">{m.expense_rebill_submit()}</Button>
		</form>
	{/if}
{/snippet}
{#snippet expensesEmpty()}
	<EmptyState icon="▧" title={m.contract_detail_empty_title()} body={m.expense_empty()} />
{/snippet}

<Page title={contract.title} {subtitle} crumbs={data.crumbs} width="wide">
	{#snippet actions()}
		<Badge
			variant={contract.status === 'active' ? 'good' : 'neutral'}
			label={statusLabel(contract.status)}
		/>
		<Button href={`${resolve('/day/new')}?contractId=${contract.id}`} variant="primary" size="sm">
			{m.contract_detail_register_day_action()}
		</Button>
		<Button
			href={`${resolve('/invoices/new')}?contractId=${contract.id}`}
			variant="secondary"
			size="sm"
		>
			{m.contract_detail_new_invoice_action()}
		</Button>
		<Button
			href={resolve('/clients/[id]/contracts/[contractId]/edit', {
				id: contract.client.id,
				contractId: contract.id
			})}
			variant="tertiary"
			size="sm"
		>
			{m.contract_edit_link()}
		</Button>
	{/snippet}

	<div class="stats">
		<StatTile
			label={m.contract_detail_stat_days_label()}
			value={daysThisYearLabel}
			sub={m.contract_detail_stat_days_unit()}
		/>
		<StatTile
			label={m.contract_detail_stat_value_label()}
			value={formatMinorUnits(data.stats.valueWorkedThisYear, contract.currency)}
			sub={m.contract_detail_stat_value_sub()}
		/>
		<StatTile
			label={m.contract_detail_stat_outstanding_label()}
			value={formatMinorUnits(data.stats.outstanding, contract.currency)}
			sub={outstandingSub}
		/>
		<StatTile
			label={m.contract_detail_stat_collected_label()}
			value={formatMinorUnits(data.stats.collected, contract.currency)}
			sub={collectedSub}
		/>
		<StatTile
			label={m.contract_detail_stat_rate_label()}
			value={inForceRateCard ? formatAmount(inForceRateCard.amount, contract.currency) : '—'}
			sub={inForceRateCard
				? `/ ${rateUnitLabel(inForceRateCard.unit)}`
				: m.contract_detail_stat_rate_none()}
		/>
	</div>

	{#if data.renewalWindowOpen && data.renewalWindowOpensOn && contract.endsOn && contract.renewalNoticeDays !== null}
		<div class="renewal-banner">
			<Banner tone="warning">
				<strong>{m.contract_detail_renewal_banner_title()}</strong>
				{m.contract_detail_renewal_banner_body({
					opensOn: formatDate(data.renewalWindowOpensOn),
					noticeDays: formatDays(contract.renewalNoticeDays),
					endsOn: formatDate(contract.endsOn)
				})}
			</Banner>
		</div>
	{/if}

	{@const dayColumns = [
		{ key: 'date', label: m.expense_column_date(), cell: dayDateCell },
		{ key: 'state', label: m.day_detail_state_label(), cell: dayStateCell },
		{
			key: 'quantity',
			label: m.contract_detail_column_days(),
			align: 'end',
			format: (row: DayRow) => formatDays(row.quantity)
		},
		{ key: 'amount', label: m.expense_column_amount(), align: 'end', cell: dayAmountCell }
	] satisfies readonly TableColumn<DayRow>[]}

	<Section title={m.contract_detail_days_heading()}>
		<Table
			columns={dayColumns}
			rows={data.days}
			caption={m.contract_detail_days_heading()}
			rowKey={(row) => row.id}
			rowHref={(row) => `/day/${row.id}`}
			empty={daysEmpty}
		/>
	</Section>

	{@const approvalColumns = [
		{
			key: 'receivedAt',
			label: m.contract_approval_column_received_at(),
			cell: approvalReceivedCell
		},
		{
			key: 'channel',
			label: m.contract_approval_column_channel(),
			format: (row: ApprovalRow) => noticeChannelLabel(row.channel as NoticeChannelValue)
		},
		{
			key: 'sender',
			label: m.contract_approval_column_sender(),
			format: (row: ApprovalRow) => row.sender
		}
	] satisfies readonly TableColumn<ApprovalRow>[]}

	<Section title={m.contract_approval_section_heading()}>
		{#snippet actions()}
			<a href="{resolve('/approvals/new')}?contractId={contract.id}" class="underline"
				>{m.contract_approval_record_link()}</a
			>
		{/snippet}
		<Table
			columns={approvalColumns}
			rows={data.approvals}
			caption={m.contract_approval_section_heading()}
			rowKey={(row) => row.id}
			rowHref={(row) => `/documents/${row.documentId}`}
			empty={approvalsEmpty}
		/>
	</Section>

	{@const invoiceColumns = [
		{
			key: 'number',
			label: m.contract_detail_column_number(),
			format: (row: InvoiceRow) => row.number
		},
		{
			key: 'issueDate',
			label: m.contract_detail_column_issued(),
			format: (row: InvoiceRow) => formatDate(row.issueDate)
		},
		{ key: 'status', label: m.day_detail_state_label(), cell: invoiceStatusCell },
		{ key: 'total', label: m.invoice_detail_total_label(), align: 'end', cell: invoiceTotalCell }
	] satisfies readonly TableColumn<InvoiceRow>[]}

	{@const rateCardColumns = [
		{ key: 'validity', label: m.rate_card_column_validity(), cell: rateCardValidityCell },
		{
			key: 'kind',
			label: m.rate_card_column_kind(),
			format: (row: RateCardRow) => rateCardKindLabel(row.kind)
		},
		{
			key: 'amount',
			label: m.rate_card_column_amount(),
			align: 'end',
			// `rate_card.amount` is a plain decimal amount, not `MinorUnits` — a
			// rate card is priced in whole currency, unlike an expense or an
			// invoice line, so `formatAmount` is the correct formatter here and
			// `formatMinorUnits` would understate it a hundredfold (#164).
			format: (row: RateCardRow) => {
				const perUnit = `${formatAmount(row.amount, contract.currency)} / ${rateUnitLabel(row.unit)}`;
				return row.disbursementPeriod
					? `${perUnit} (${disbursementPeriodLabel(row.disbursementPeriod)})`
					: perUnit;
			}
		},
		{ key: 'inForce', label: m.day_detail_state_label(), cell: rateCardInForceCell }
	] satisfies readonly TableColumn<RateCardRow>[]}

	<div class="cols-2">
		<Section title={m.contract_detail_invoices_heading()}>
			<Table
				columns={invoiceColumns}
				rows={data.invoices}
				caption={m.contract_detail_invoices_heading()}
				rowKey={(row) => row.id}
				rowHref={(row) => `/invoices/${row.id}`}
				empty={invoicesEmpty}
			/>
		</Section>

		<Section title={m.rate_card_section_heading()}>
			{#snippet actions()}
				<a
					href={resolve('/clients/[id]/contracts/[contractId]/rate-cards/new', {
						id: contract.client.id,
						contractId: contract.id
					})}
					class="underline">{m.rate_card_new_link()}</a
				>
			{/snippet}
			<Table
				columns={rateCardColumns}
				rows={data.rateCards}
				caption={m.rate_card_section_heading()}
				rowKey={(row) => row.id}
				rowHref={(row) =>
					`/clients/${contract.client.id}/contracts/${contract.id}/rate-cards/${row.id}/edit`}
				empty={rateCardsEmpty}
			/>
		</Section>
	</div>

	{@const expenseColumns = [
		{
			key: 'date',
			label: m.expense_column_date(),
			format: (row: ExpenseRow) => formatDate(row.date)
		},
		{
			key: 'description',
			label: m.expense_column_description(),
			format: (row: ExpenseRow) => row.description
		},
		{ key: 'amount', label: m.expense_column_amount(), align: 'end', cell: expenseAmountCell },
		{ key: 'status', label: m.day_detail_state_label(), cell: expenseStatusCell },
		{ key: 'rebill', label: m.expense_rebill_submit(), cell: expenseRebillCell }
	] satisfies readonly TableColumn<ExpenseRow>[]}

	<Section title={m.expense_section_heading()}>
		{#snippet actions()}
			<a
				href={resolve('/clients/[id]/contracts/[contractId]/expenses/new', {
					id: contract.client.id,
					contractId: contract.id
				})}
				class="underline">{m.expense_new_link()}</a
			>
		{/snippet}
		{#if form?.rebillError}
			<Banner tone="critical">{form.rebillError}</Banner>
		{/if}
		<Table
			columns={expenseColumns}
			rows={data.expenses}
			caption={m.expense_section_heading()}
			rowKey={(row) => row.id}
			rowHref={(row) =>
				`/clients/${contract.client.id}/contracts/${contract.id}/expenses/${row.id}/edit`}
			empty={expensesEmpty}
		/>
	</Section>

	<Section title={m.clause_note_section_heading()}>
		{#snippet actions()}
			<a
				href={resolve('/clients/[id]/contracts/[contractId]/clause-notes/new', {
					id: contract.client.id,
					contractId: contract.id
				})}
				class="underline">{m.clause_note_new_link()}</a
			>
		{/snippet}

		{#if data.clauseNotes.length === 0}
			<p class="empty-note">{m.clause_note_empty()}</p>
		{:else}
			<div class="clause-list">
				{#each data.clauseNotes as note (note.id)}
					<Card>
						<a
							class="clause-heading"
							href={resolve(
								'/clients/[id]/contracts/[contractId]/clause-notes/[clauseNoteId]/edit',
								{ id: contract.client.id, contractId: contract.id, clauseNoteId: note.id }
							)}
						>
							{note.clauseReference} — {m.contract_detail_clause_verbatim_suffix()}
						</a>
						<p class="verbatim">"{note.verbatimText}"</p>
						<p class="field-label">{m.clause_note_form_interpretation_adopted_label()}</p>
						<p class="interpretation">{note.interpretationAdopted}</p>
						{#if note.notes}
							<p class="field-label">{m.clause_note_form_notes_label()}</p>
							<p class="notes">{note.notes}</p>
						{/if}
					</Card>
				{/each}
			</div>
		{/if}
	</Section>

	<Section title={m.contract_documents_heading()}>
		{#each data.documents as document (document.id)}
			<SourceDocument {document} />
		{:else}
			<SourceDocument document={null} />
		{/each}
	</Section>

	<Section title={m.contract_detail_terms_heading()}>
		<Card>
			<dl class="terms">
				{#each termsRows as row (row.dt)}
					<dt>{row.dt}</dt>
					<dd>{row.dd}</dd>
				{/each}
			</dl>
		</Card>
	</Section>
</Page>

<style>
	.stats {
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		gap: var(--space-4);
		margin: var(--space-4) 0 var(--space-6);
		padding: var(--space-4);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
	}
	@media (max-width: 639px) {
		.stats {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	.renewal-banner {
		margin-bottom: var(--space-6);
	}
	.stack {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.hint {
		font-size: var(--text-xs);
		color: var(--text-muted);
	}
	.unpriced {
		display: block;
		text-align: right;
		font-size: var(--text-sm);
		color: var(--text-muted);
	}
	.cols-2 {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-6);
		margin-top: 2rem;
	}
	.cols-2 + :global(.section) {
		margin-top: 2rem;
	}
	@media (max-width: 767px) {
		.cols-2 {
			grid-template-columns: 1fr;
		}
	}
	.rebill-form {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 12rem;
	}
	.clause-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.clause-heading {
		display: block;
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		color: var(--text-primary);
		margin-bottom: var(--space-2);
	}
	.verbatim {
		margin: 0 0 var(--space-3);
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}
	.field-label {
		margin: 0;
		font-size: var(--text-xs);
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}
	.interpretation,
	.notes {
		margin: 0 0 var(--space-3);
		font-size: var(--text-sm);
		color: var(--text-primary);
	}
	.interpretation:last-child,
	.notes:last-child {
		margin-bottom: 0;
	}
	.empty-note {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-muted);
	}
	.terms {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: var(--space-2) var(--space-4);
		font-size: var(--text-sm);
	}
	.terms dt {
		color: var(--text-secondary);
	}
	.terms dd {
		margin: 0;
		color: var(--text-primary);
	}
	@media (max-width: 639px) {
		.terms {
			grid-template-columns: 1fr;
		}
		.terms dt {
			margin-top: var(--space-2);
		}
	}
</style>
