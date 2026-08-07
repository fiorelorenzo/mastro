<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import type { ContractFormValues } from '$lib/server/repositories/contract-form';
	import {
		contractRenewalTypes,
		contractStatuses,
		expensePolicyKinds,
		invoicingCadences,
		paymentTermsKinds,
		expensePolicyKindLabel,
		invoicingCadenceLabel,
		paymentTermsKindLabel,
		renewalTypeLabel,
		statusLabel,
		templateLanguages
	} from './contract-enums';

	let {
		values,
		errors = {},
		submitLabel
	}: {
		values: ContractFormValues;
		errors?: Record<string, string>;
		submitLabel: string;
	} = $props();

	// Drive which conditional fields show without a round trip — the same
	// pattern `day/new/+page.svelte` uses for its own select-driven fields.
	let renewalType = $state(values.renewalType);
	let paymentTermsKind = $state(values.paymentTermsKind);
	let expensePolicyKind = $state(values.expensePolicyKind);
</script>

<form method="POST" class="mt-6 flex flex-col gap-6">
	<fieldset class="flex flex-col gap-3">
		<legend class="text-sm font-semibold">{m.contract_form_identity_legend()}</legend>
		<label class="flex flex-col gap-1 text-sm">
			{m.contract_form_title_label()}
			<input name="title" value={values.title} class="border px-2 py-1" required />
			{#if errors.title}<span class="text-xs font-semibold">{errors.title}</span>{/if}
		</label>
		<label class="flex flex-col gap-1 text-sm">
			{m.contract_form_signed_document_reference_label()}
			<input
				name="signedDocumentReference"
				value={values.signedDocumentReference}
				class="border px-2 py-1"
			/>
		</label>
		<label class="flex flex-col gap-1 text-sm">
			{m.contract_form_status_label()}
			<select name="status" value={values.status} class="border px-2 py-1" required>
				{#each contractStatuses as status (status)}
					<option value={status} selected={values.status === status}>{statusLabel(status)}</option>
				{/each}
			</select>
			{#if errors.status}<span class="text-xs font-semibold">{errors.status}</span>{/if}
		</label>
		<label class="flex flex-col gap-1 text-sm">
			{m.mail_contract_template_language_legend()}
			<select name="templateLanguage" class="border px-2 py-1" required>
				{#each templateLanguages as language (language)}
					<option value={language} selected={values.templateLanguage === language}>
						{language}
					</option>
				{/each}
			</select>
			<span class="text-xs opacity-70">{m.mail_contract_template_language_hint()}</span>
			{#if errors.templateLanguage}<span class="text-xs font-semibold"
					>{errors.templateLanguage}</span
				>{/if}
		</label>
	</fieldset>

	<fieldset class="flex flex-col gap-3">
		<legend class="text-sm font-semibold">{m.contract_form_term_legend()}</legend>
		<label class="flex flex-col gap-1 text-sm">
			{m.contract_form_starts_on_label()}
			<input
				type="date"
				name="startsOn"
				value={values.startsOn}
				class="border px-2 py-1"
				required
			/>
			{#if errors.startsOn}<span class="text-xs font-semibold">{errors.startsOn}</span>{/if}
		</label>
		<label class="flex flex-col gap-1 text-sm">
			{m.contract_form_ends_on_label()}
			<input type="date" name="endsOn" value={values.endsOn} class="border px-2 py-1" />
			{#if errors.endsOn}<span class="text-xs font-semibold">{errors.endsOn}</span>{/if}
		</label>
		<label class="flex flex-col gap-1 text-sm">
			{m.contract_form_renewal_type_label()}
			<select name="renewalType" bind:value={renewalType} class="border px-2 py-1" required>
				{#each contractRenewalTypes as type (type)}
					<option value={type} selected={values.renewalType === type}
						>{renewalTypeLabel(type)}</option
					>
				{/each}
			</select>
			{#if errors.renewalType}<span class="text-xs font-semibold">{errors.renewalType}</span>{/if}
		</label>
		{#if renewalType !== 'none'}
			<label class="flex flex-col gap-1 text-sm">
				{m.contract_form_renewal_notice_days_label()}
				<input
					type="number"
					min="0"
					step="1"
					name="renewalNoticeDays"
					value={values.renewalNoticeDays}
					class="border px-2 py-1"
					required
				/>
				{#if errors.renewalNoticeDays}<span class="text-xs font-semibold"
						>{errors.renewalNoticeDays}</span
					>{/if}
			</label>
		{/if}
		<label class="flex flex-col gap-1 text-sm">
			{m.contract_form_termination_notice_days_label()}
			<input
				type="number"
				min="0"
				step="1"
				name="terminationNoticeDays"
				value={values.terminationNoticeDays}
				class="border px-2 py-1"
				required
			/>
			{#if errors.terminationNoticeDays}<span class="text-xs font-semibold"
					>{errors.terminationNoticeDays}</span
				>{/if}
		</label>
	</fieldset>

	<fieldset class="flex flex-col gap-3">
		<legend class="text-sm font-semibold">{m.contract_form_payment_legend()}</legend>
		<label class="flex flex-col gap-1 text-sm">
			{m.contract_form_payment_terms_kind_label()}
			<select
				name="paymentTermsKind"
				bind:value={paymentTermsKind}
				class="border px-2 py-1"
				required
			>
				{#each paymentTermsKinds as kind (kind)}
					<option value={kind} selected={values.paymentTermsKind === kind}
						>{paymentTermsKindLabel(kind)}</option
					>
				{/each}
			</select>
			{#if errors.paymentTermsKind}<span class="text-xs font-semibold"
					>{errors.paymentTermsKind}</span
				>{/if}
		</label>
		{#if paymentTermsKind === 'net'}
			<label class="flex flex-col gap-1 text-sm">
				{m.contract_form_payment_terms_net_days_label()}
				<input
					type="number"
					min="1"
					step="1"
					name="paymentTermsNetDays"
					value={values.paymentTermsNetDays}
					class="border px-2 py-1"
					required
				/>
				{#if errors.paymentTermsNetDays}<span class="text-xs font-semibold"
						>{errors.paymentTermsNetDays}</span
					>{/if}
			</label>
		{:else}
			<label class="flex flex-col gap-1 text-sm">
				{m.contract_form_payment_terms_day_of_month_label()}
				<input
					type="number"
					min="1"
					max="31"
					step="1"
					name="paymentTermsDayOfMonthDay"
					value={values.paymentTermsDayOfMonthDay}
					class="border px-2 py-1"
					required
				/>
				<span class="text-xs opacity-70">{m.contract_form_payment_terms_day_of_month_hint()}</span>
				{#if errors.paymentTermsDayOfMonthDay}<span class="text-xs font-semibold"
						>{errors.paymentTermsDayOfMonthDay}</span
					>{/if}
			</label>
		{/if}
		<label class="flex flex-col gap-1 text-sm">
			{m.contract_form_invoicing_cadence_label()}
			<select
				name="invoicingCadence"
				value={values.invoicingCadence}
				class="border px-2 py-1"
				required
			>
				{#each invoicingCadences as cadence (cadence)}
					<option value={cadence} selected={values.invoicingCadence === cadence}
						>{invoicingCadenceLabel(cadence)}</option
					>
				{/each}
			</select>
			{#if errors.invoicingCadence}<span class="text-xs font-semibold"
					>{errors.invoicingCadence}</span
				>{/if}
		</label>
		<label class="flex flex-col gap-1 text-sm">
			{m.contract_form_currency_label()}
			<input
				name="currency"
				value={values.currency}
				maxlength="3"
				class="border px-2 py-1 uppercase"
				required
			/>
			{#if errors.currency}<span class="text-xs font-semibold">{errors.currency}</span>{/if}
		</label>
		<label class="flex flex-col gap-1 text-sm">
			{m.contract_form_tax_treatment_label()}
			<input name="taxTreatment" value={values.taxTreatment} class="border px-2 py-1" required />
			<span class="text-xs opacity-70">{m.contract_form_tax_treatment_hint()}</span>
			{#if errors.taxTreatment}<span class="text-xs font-semibold">{errors.taxTreatment}</span>{/if}
		</label>
	</fieldset>

	<fieldset class="flex flex-col gap-3">
		<legend class="text-sm font-semibold">{m.contract_form_approval_and_expenses_legend()}</legend>
		<label class="flex items-center gap-2 text-sm">
			<input type="checkbox" name="requiresPriorApproval" checked={values.requiresPriorApproval} />
			{m.contract_form_requires_prior_approval_label()}
		</label>
		<label class="flex flex-col gap-1 text-sm">
			{m.contract_form_expense_policy_kind_label()}
			<select
				name="expensePolicyKind"
				bind:value={expensePolicyKind}
				class="border px-2 py-1"
				required
			>
				{#each expensePolicyKinds as kind (kind)}
					<option value={kind} selected={values.expensePolicyKind === kind}
						>{expensePolicyKindLabel(kind)}</option
					>
				{/each}
			</select>
			{#if errors.expensePolicyKind}<span class="text-xs font-semibold"
					>{errors.expensePolicyKind}</span
				>{/if}
		</label>
		{#if expensePolicyKind === 'reimbursed_with_cap'}
			<label class="flex flex-col gap-1 text-sm">
				{m.contract_form_expense_policy_cap_amount_label()}
				<input
					name="expensePolicyCapAmount"
					value={values.expensePolicyCapAmount}
					class="border px-2 py-1"
					required
				/>
				{#if errors.expensePolicyCapAmount}<span class="text-xs font-semibold"
						>{errors.expensePolicyCapAmount}</span
					>{/if}
			</label>
		{/if}
		{#if expensePolicyKind !== 'not_reimbursed'}
			<label class="flex items-center gap-2 text-sm">
				<input
					type="checkbox"
					name="requiresExpensePreAuthorisation"
					checked={values.requiresExpensePreAuthorisation}
				/>
				{m.contract_form_requires_expense_pre_authorisation_label()}
			</label>
			{#if errors.requiresExpensePreAuthorisation}<span class="text-xs font-semibold"
					>{errors.requiresExpensePreAuthorisation}</span
				>{/if}
		{/if}
	</fieldset>

	<button type="submit" class="w-fit border px-4 py-2 text-sm">{submitLabel}</button>
</form>
