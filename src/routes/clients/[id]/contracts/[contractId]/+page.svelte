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
	import PageHeader from '$lib/nav/PageHeader.svelte';
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
	import ReimbursableBadge from './expenses/ReimbursableBadge.svelte';
	import type { ActionData, PageProps } from './$types';

	let { data, form }: PageProps & { form: ActionData } = $props();

	const contract = $derived(data.contract);
	const subtitle = $derived(
		factLine([
			formatDate(contract.startsOn),
			renewalTypeLabel(contract.renewalType),
			m.contract_subtitle_notice_period({ days: formatDays(contract.terminationNoticeDays) })
		])
	);
</script>

<svelte:head><title>{m.contract_detail_page_title({ title: contract.title })}</title></svelte:head>

<main class="mx-auto max-w-3xl p-8">
	<PageHeader crumbs={data.crumbs} title={contract.title} {subtitle}>
		{#snippet actions()}
			<a
				href={resolve('/clients/[id]/contracts/[contractId]/edit', {
					id: contract.client.id,
					contractId: contract.id
				})}
				class="text-sm underline">{m.contract_edit_link()}</a
			>
		{/snippet}
	</PageHeader>

	<section class="mt-6">
		<h2 class="text-lg font-semibold">{m.contract_form_identity_legend()}</h2>
		<dl class="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
			<dt class="opacity-70">{m.contract_form_status_label()}</dt>
			<dd>{statusLabel(contract.status)}</dd>
			{#if contract.signedDocumentReference}
				<dt class="opacity-70">{m.contract_form_signed_document_reference_label()}</dt>
				<dd>{contract.signedDocumentReference}</dd>
			{/if}
		</dl>
	</section>

	<section class="mt-6">
		<h2 class="text-lg font-semibold">{m.contract_form_term_legend()}</h2>
		<dl class="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
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

		<!--
			#20's whole point: a clause note sits right here, next to the
			renewal fields it affects, on the same single page — this app has
			no detail tabs to bury it in.
		-->
		<div class="mt-4 border-l-2 pl-4">
			<div class="flex items-center justify-between">
				<h3 class="text-sm font-semibold">{m.clause_note_section_heading()}</h3>
				<a
					href={resolve('/clients/[id]/contracts/[contractId]/clause-notes/new', {
						id: contract.client.id,
						contractId: contract.id
					})}
					class="text-sm underline">{m.clause_note_new_link()}</a
				>
			</div>
			{#if data.clauseNotes.length === 0}
				<p class="mt-2 text-sm opacity-70">{m.clause_note_empty()}</p>
			{:else}
				<ul class="mt-2 flex flex-col gap-3">
					{#each data.clauseNotes as note (note.id)}
						<li class="text-sm">
							<p class="font-semibold">{note.clauseReference}</p>
							<p class="mt-1 italic opacity-80">"{note.verbatimText}"</p>
							<p class="mt-1">
								{m.clause_note_interpretation_prefix()}
								{note.interpretationAdopted}
							</p>
							{#if note.notes}<p class="mt-1 opacity-70">{note.notes}</p>{/if}
							<a
								href={resolve(
									'/clients/[id]/contracts/[contractId]/clause-notes/[clauseNoteId]/edit',
									{
										id: contract.client.id,
										contractId: contract.id,
										clauseNoteId: note.id
									}
								)}
								class="text-xs underline">{m.clause_note_edit_link()}</a
							>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</section>

	<section class="mt-6">
		<h2 class="text-lg font-semibold">{m.contract_form_payment_legend()}</h2>
		<dl class="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
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
	</section>

	<section class="mt-6">
		<h2 class="text-lg font-semibold">{m.contract_form_approval_and_expenses_legend()}</h2>
		<dl class="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
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
	</section>

	<section class="mt-6">
		<div class="flex items-center justify-between">
			<h2 class="text-lg font-semibold">{m.rate_card_section_heading()}</h2>
			<a
				href={resolve('/clients/[id]/contracts/[contractId]/rate-cards/new', {
					id: contract.client.id,
					contractId: contract.id
				})}
				class="text-sm underline">{m.rate_card_new_link()}</a
			>
		</div>
		{#if data.rateCards.length === 0}
			<p class="mt-2 text-sm opacity-70">{m.rate_card_empty()}</p>
		{:else}
			<table class="mt-2 w-full border-collapse text-sm">
				<thead>
					<tr class="border-b text-left">
						<th class="py-2 pr-4">{m.rate_card_column_validity()}</th>
						<th class="py-2 pr-4">{m.rate_card_column_kind()}</th>
						<th class="py-2 pr-4">{m.rate_card_column_amount()}</th>
						<th class="py-2"></th>
					</tr>
				</thead>
				<tbody>
					{#each data.rateCards as card (card.id)}
						<tr class="border-b">
							<td class="py-2 pr-4"
								>{formatDate(card.validFrom)} – {card.validTo
									? formatDate(card.validTo)
									: m.rate_card_valid_to_open()}</td
							>
							<td class="py-2 pr-4">{rateCardKindLabel(card.kind)}</td>
							<td class="py-2 pr-4">
								{formatAmount(card.amount, contract.currency)} / {rateUnitLabel(card.unit)}
								{#if card.disbursementPeriod}
									({disbursementPeriodLabel(card.disbursementPeriod)})
								{/if}
							</td>
							<td class="py-2">
								<a
									href={resolve(
										'/clients/[id]/contracts/[contractId]/rate-cards/[rateCardId]/edit',
										{ id: contract.client.id, contractId: contract.id, rateCardId: card.id }
									)}
									class="underline">{m.rate_card_edit_link()}</a
								>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</section>

	<section class="mt-6">
		<div class="flex items-center justify-between">
			<h2 class="text-lg font-semibold">{m.expense_section_heading()}</h2>
			<a
				href={resolve('/clients/[id]/contracts/[contractId]/expenses/new', {
					id: contract.client.id,
					contractId: contract.id
				})}
				class="text-sm underline">{m.expense_new_link()}</a
			>
		</div>
		{#if form?.rebillError}<p class="mt-2 text-xs font-semibold">{form.rebillError}</p>{/if}
		{#if data.expenses.length === 0}
			<p class="mt-2 text-sm opacity-70">{m.expense_empty()}</p>
		{:else}
			<table class="mt-2 w-full border-collapse text-sm">
				<thead>
					<tr class="border-b text-left">
						<th class="py-2 pr-4">{m.expense_column_date()}</th>
						<th class="py-2 pr-4">{m.expense_column_description()}</th>
						<th class="py-2 pr-4">{m.expense_column_amount()}</th>
						<th class="py-2 pr-4">{m.expense_column_reimbursable()}</th>
						<th class="py-2 pr-4">{m.expense_column_rebilled()}</th>
						<th class="py-2"></th>
					</tr>
				</thead>
				<tbody>
					{#each data.expenses as row (row.id)}
						<tr class="border-b align-top">
							<td class="py-2 pr-4">{formatDate(row.date)}</td>
							<td class="py-2 pr-4">{row.description}</td>
							<td class="py-2 pr-4">{formatMinorUnits(row.amount, contract.currency)}</td>
							<td class="py-2 pr-4"><ReimbursableBadge reimbursable={row.reimbursable} /></td>
							<td class="py-2 pr-4">
								{#if row.invoiceLineId}
									{m.expense_rebilled_yes()}
								{:else if row.reimbursable && data.invoiceLines.length > 0}
									<form method="POST" action="?/rebill" class="flex items-center gap-2">
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
								{:else}
									{m.expense_rebilled_no()}
								{/if}
							</td>
							<td class="py-2">
								<a
									href={resolve('/clients/[id]/contracts/[contractId]/expenses/[expenseId]/edit', {
										id: contract.client.id,
										contractId: contract.id,
										expenseId: row.id
									})}
									class="underline">{m.expense_edit_link()}</a
								>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</section>
</main>
