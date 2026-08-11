<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import {
		formatAmount,
		formatDate,
		formatDays,
		formatMinorUnits,
		formatNumber
	} from '$lib/i18n/format';
	import { factLine } from '$lib/nav/crumbs';
	import Page from '$lib/layout/Page.svelte';
	import Section from '$lib/layout/Section.svelte';
	import RecordList from '$lib/layout/RecordList.svelte';
	import type { RecordColumn } from '$lib/layout/types';
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
	import type { ActionData, PageData, PageProps } from './$types';

	let { data, form }: PageProps & { form: ActionData } = $props();

	const contract = $derived(data.contract);
	const subtitle = $derived(
		factLine([
			formatDate(contract.startsOn),
			renewalTypeLabel(contract.renewalType),
			m.contract_subtitle_notice_period({ days: formatDays(contract.terminationNoticeDays) })
		])
	);

	type RateCardRow = PageData['rateCards'][number];
	type ClauseNoteRow = PageData['clauseNotes'][number];
	type ExpenseRow = PageData['expenses'][number];

	const rateCardColumns: readonly RecordColumn<RateCardRow>[] = $derived([
		{
			key: 'validFrom',
			label: m.rate_card_column_validity(),
			format: (card: RateCardRow) =>
				`${formatDate(card.validFrom)} – ${card.validTo ? formatDate(card.validTo) : m.rate_card_valid_to_open()}`
		},
		{
			key: 'kind',
			label: m.rate_card_column_kind(),
			format: (card: RateCardRow) => rateCardKindLabel(card.kind)
		},
		{
			key: 'amount',
			label: m.rate_card_column_amount(),
			align: 'end',
			// `rate_card.amount` is a plain decimal amount, not `MinorUnits` — a
			// rate card is priced in whole currency, unlike an expense or an
			// invoice line, so `formatAmount` is the correct formatter here and
			// `formatMinorUnits` would understate it a hundredfold (#164).
			format: (card: RateCardRow) => {
				const perUnit = `${formatAmount(card.amount, contract.currency)} / ${rateUnitLabel(card.unit)}`;
				return card.disbursementPeriod
					? `${perUnit} (${disbursementPeriodLabel(card.disbursementPeriod)})`
					: perUnit;
			}
		}
	]);

	// Reuses the create/edit form's own field labels (`ContractForm`'s
	// clause-note fieldset has no on-page twin) rather than inventing a
	// second set of column headers for the same four facts.
	const clauseNoteColumns: readonly RecordColumn<ClauseNoteRow>[] = $derived([
		{ key: 'clauseReference', label: m.clause_note_form_clause_reference_label() },
		{
			key: 'verbatimText',
			label: m.clause_note_form_verbatim_text_label(),
			format: (note: ClauseNoteRow) => `"${note.verbatimText}"`
		},
		{
			key: 'interpretationAdopted',
			label: m.clause_note_form_interpretation_adopted_label()
		},
		{
			key: 'notes',
			label: m.clause_note_form_notes_label(),
			format: (note: ClauseNoteRow) => note.notes ?? ''
		}
	]);

	const expenseColumns: readonly RecordColumn<ExpenseRow>[] = $derived([
		{
			key: 'date',
			label: m.expense_column_date(),
			format: (row: ExpenseRow) => formatDate(row.date)
		},
		{ key: 'description', label: m.expense_column_description() },
		{
			key: 'amount',
			label: m.expense_column_amount(),
			align: 'end',
			// `expense.amount` is `MinorUnits` (integer cents), the same
			// convention `invoice`/`invoice_line` use — see the schema comment
			// on `expense.ts`. `formatMinorUnits` is the only correct formatter.
			format: (row: ExpenseRow) => formatMinorUnits(row.amount, contract.currency)
		},
		{
			key: 'reimbursable',
			label: m.expense_column_reimbursable(),
			format: (row: ExpenseRow) =>
				row.reimbursable ? m.expense_reimbursable_label() : m.expense_non_reimbursable_label()
		},
		{
			key: 'rebilled',
			label: m.expense_column_rebilled(),
			format: (row: ExpenseRow) =>
				row.invoiceLineId ? m.expense_rebilled_yes() : m.expense_rebilled_no()
		}
	]);

	// The one row action `RecordList` cannot express: rebilling posts a form
	// with an invoice-line picker, not a plain cell value. It stays a small
	// list of its own beneath the record list, offered only for the rows it
	// applies to (reimbursable, not yet rebilled, and there is somewhere to
	// rebill it onto) — the same set the old inline form used.
	const pendingRebill = $derived(
		data.invoiceLines.length > 0
			? data.expenses.filter((row) => row.reimbursable && !row.invoiceLineId)
			: []
	);
</script>

<svelte:head><title>{m.contract_detail_page_title({ title: contract.title })}</title></svelte:head>

<Page title={contract.title} {subtitle} crumbs={data.crumbs}>
	{#snippet actions()}
		<a
			href={resolve('/clients/[id]/contracts/[contractId]/edit', {
				id: contract.client.id,
				contractId: contract.id
			})}
			class="underline">{m.contract_edit_link()}</a
		>
	{/snippet}

	<!--
		Identity and term merged: on its own "Identity" was two facts (status,
		an optional signed-document reference), thinner than every section
		around it, and both it and "term" are the same kind of thing — static
		facts about this contract's own state and timeline, as opposed to
		payment (money) or approval/expenses (workflow). Clause notes used to
		nest inside "term" with hand-rolled indentation; it is a record list
		now, so it gets its own section instead, the same standing rate cards
		and expenses have.
	-->
	<Section title={m.contract_form_identity_legend()}>
		<dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
			<dt class="opacity-70">{m.contract_form_status_label()}</dt>
			<dd>{statusLabel(contract.status)}</dd>
			{#if contract.signedDocumentReference}
				<dt class="opacity-70">{m.contract_form_signed_document_reference_label()}</dt>
				<dd>{contract.signedDocumentReference}</dd>
			{/if}
			<dt class="opacity-70">{m.contract_form_starts_on_label()}</dt>
			<dd>{formatDate(contract.startsOn)}</dd>
			<dt class="opacity-70">{m.contract_form_ends_on_label()}</dt>
			<dd>{contract.endsOn ? formatDate(contract.endsOn) : m.contract_ends_on_open()}</dd>
			<dt class="opacity-70">{m.contract_form_renewal_type_label()}</dt>
			<dd>{renewalTypeLabel(contract.renewalType)}</dd>
			{#if contract.renewalNoticeDays !== null}
				<dt class="opacity-70">{m.contract_form_renewal_notice_days_label()}</dt>
				<dd>{formatNumber(contract.renewalNoticeDays)}</dd>
			{/if}
			{#if data.renewalWindowOpensOn}
				<dt class="opacity-70">{m.contract_renewal_window_opens_on_label()}</dt>
				<dd>{formatDate(data.renewalWindowOpensOn)}</dd>
			{/if}
			<dt class="opacity-70">{m.contract_form_termination_notice_days_label()}</dt>
			<dd>{formatNumber(contract.terminationNoticeDays)}</dd>
		</dl>
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
			<p class="text-sm opacity-70">{m.clause_note_empty()}</p>
		{:else}
			<RecordList
				columns={clauseNoteColumns}
				rows={data.clauseNotes}
				caption={m.clause_note_section_heading()}
				rowKey={(note) => note.id}
				rowHref={(note) =>
					resolve('/clients/[id]/contracts/[contractId]/clause-notes/[clauseNoteId]/edit', {
						id: contract.client.id,
						contractId: contract.id,
						clauseNoteId: note.id
					})}
			/>
		{/if}
	</Section>

	<Section title={m.contract_form_payment_legend()}>
		<dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
			<dt class="opacity-70">{m.contract_form_payment_terms_kind_label()}</dt>
			<dd>
				{paymentTermsKindLabel(contract.paymentTerms.kind)}
				{#if contract.paymentTerms.kind === 'net'}
					({formatNumber(contract.paymentTerms.days)})
				{:else}
					({formatNumber(contract.paymentTerms.day)})
				{/if}
			</dd>
			<dt class="opacity-70">{m.contract_form_invoicing_cadence_label()}</dt>
			<dd>{invoicingCadenceLabel(contract.invoicingCadence)}</dd>
			<dt class="opacity-70">{m.contract_form_currency_label()}</dt>
			<dd>{contract.currency}</dd>
			<dt class="opacity-70">{m.contract_form_tax_treatment_label()}</dt>
			<dd>{contract.taxTreatment}</dd>
		</dl>
	</Section>

	<Section title={m.contract_form_approval_and_expenses_legend()}>
		<dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
			<dt class="opacity-70">{m.contract_form_requires_prior_approval_label()}</dt>
			<dd>{contract.requiresPriorApproval ? m.contract_boolean_yes() : m.contract_boolean_no()}</dd>
			<dt class="opacity-70">{m.contract_form_expense_policy_kind_label()}</dt>
			<dd>
				{expensePolicyKindLabel(contract.expensePolicy.kind)}
				{#if contract.expensePolicy.kind === 'reimbursed_with_cap'}
					({formatMinorUnits(contract.expensePolicy.capAmount, contract.currency)})
				{/if}
			</dd>
			<dt class="opacity-70">{m.contract_form_requires_expense_pre_authorisation_label()}</dt>
			<dd>
				{contract.requiresExpensePreAuthorisation
					? m.contract_boolean_yes()
					: m.contract_boolean_no()}
			</dd>
		</dl>
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

		{#if data.rateCards.length === 0}
			<p class="text-sm opacity-70">{m.rate_card_empty()}</p>
		{:else}
			<RecordList
				columns={rateCardColumns}
				rows={data.rateCards}
				caption={m.rate_card_section_heading()}
				rowKey={(card) => card.id}
				rowHref={(card) =>
					resolve('/clients/[id]/contracts/[contractId]/rate-cards/[rateCardId]/edit', {
						id: contract.client.id,
						contractId: contract.id,
						rateCardId: card.id
					})}
			/>
		{/if}
	</Section>

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

		{#if form?.rebillError}<p class="text-xs font-semibold">{form.rebillError}</p>{/if}
		{#if data.expenses.length === 0}
			<p class="text-sm opacity-70">{m.expense_empty()}</p>
		{:else}
			<RecordList
				columns={expenseColumns}
				rows={data.expenses}
				caption={m.expense_section_heading()}
				rowKey={(row) => row.id}
				rowHref={(row) =>
					resolve('/clients/[id]/contracts/[contractId]/expenses/[expenseId]/edit', {
						id: contract.client.id,
						contractId: contract.id,
						expenseId: row.id
					})}
			/>
			{#if pendingRebill.length > 0}
				<ul class="mt-3 flex flex-col gap-2 text-sm">
					{#each pendingRebill as row (row.id)}
						<li>
							<form method="POST" action="?/rebill" class="flex flex-wrap items-center gap-2">
								<span class="opacity-70">{formatDate(row.date)} — {row.description}</span>
								<input type="hidden" name="expenseId" value={row.id} />
								<select name="invoiceLineId" class="border px-1 py-0.5 text-xs" required>
									<option value="" disabled selected>{m.expense_rebill_placeholder()}</option>
									{#each data.invoiceLines as line (line.id)}
										<option value={line.id}>{line.invoiceNumber} — {line.description}</option>
									{/each}
								</select>
								<button type="submit" class="border px-2 py-0.5 text-xs"
									>{m.expense_rebill_submit()}</button
								>
							</form>
						</li>
					{/each}
				</ul>
			{/if}
		{/if}
	</Section>
</Page>
