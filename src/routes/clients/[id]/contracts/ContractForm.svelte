<script lang="ts">
	/*
	 * ContractForm.svelte — create/edit form for a contract (#241). Six
	 * named cards instead of one flat column of every field: Identità,
	 * Approvazioni, Denaro, Rinnovo e recesso, Spese, Comunicazioni — the
	 * conditional rules a person used to have to already know (a renewal
	 * notice period only applies to a renewal type that isn't "none", an
	 * expense cap only to a policy that has one) are now shown only when
	 * they apply, the same select-driven pattern `day/new/+page.svelte`
	 * uses for its own conditional fields.
	 *
	 * The approval requirement keeps #211's shape exactly: a `SegmentedControl`
	 * with neither option pressed until one is chosen, and both consequences
	 * always visible — only its position moved, into its own card right
	 * after Identità, per the mockup.
	 */
	import * as m from '$lib/paraglide/messages';
	import {
		AmountInput,
		Button,
		Checkbox,
		Field,
		Input,
		Select,
		SegmentedControl,
		countryOptions
	} from '$lib/design';
	import { getLocale } from '$lib/paraglide/runtime';
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
		client,
		errors = {},
		submitLabel
	}: {
		values: ContractFormValues;
		/** Just enough of the client this contract belongs to for the
		 *  Comunicazioni card's "follows the client's own language" hint —
		 *  the form itself never lets you change which client a contract
		 *  belongs to (that is fixed by the route it was created under). */
		client: { legalName: string; country: string };
		errors?: Record<string, string>;
		submitLabel: string;
	} = $props();

	// Drive which conditional fields show without a round trip — the same
	// pattern `day/new/+page.svelte` uses for its own select-driven fields.
	let renewalType = $state(values.renewalType);
	let paymentTermsKind = $state(values.paymentTermsKind);
	let expensePolicyKind = $state(values.expensePolicyKind);
	let currency = $state(values.currency);

	// #211: the approval requirement is never defaulted — `values.requiresPriorApproval`
	// is `null` on a brand-new contract (nothing chosen yet) and a real
	// boolean once either a submission or an existing contract has made the
	// choice. The segmented control shows neither option pressed until one
	// is; `requiresPriorApprovalChoice` stays `''` in that case, which is
	// deliberately not a legal form value (`parseContractForm` rejects it)
	// rather than a default in disguise.
	let requiresPriorApprovalChoice = $state(
		values.requiresPriorApproval === true
			? 'required'
			: values.requiresPriorApproval === false
				? 'not_required'
				: ''
	);

	const clientCountryName = $derived(
		countryOptions(getLocale()).find((option) => option.code === client.country)?.name ??
			client.country
	);
</script>

<form method="POST" class="mt-6 flex flex-col gap-5">
	<fieldset class="card">
		<legend><h2>{m.contract_form_identity_legend()}</h2></legend>
		<Field label={m.contract_form_title_label()} error={errors.title} required>
			<Input name="title" value={values.title} required />
		</Field>
		<Field
			label={m.contract_form_signed_document_reference_label()}
			error={errors.signedDocumentReference}
		>
			<Input name="signedDocumentReference" value={values.signedDocumentReference} />
		</Field>
		<div class="grid-2">
			<Field
				label={m.contract_form_status_label()}
				hint={m.contract_form_status_hint()}
				error={errors.status}
				required
			>
				<Select name="status" value={values.status} required>
					{#each contractStatuses as status (status)}
						<option value={status} selected={values.status === status}>
							{statusLabel(status)}
						</option>
					{/each}
				</Select>
			</Field>
			<Field label={m.contract_form_starts_on_label()} error={errors.startsOn} required>
				<Input type="date" name="startsOn" value={values.startsOn} required />
			</Field>
		</div>
		<Field label={m.contract_form_ends_on_label()} error={errors.endsOn}>
			<Input type="date" name="endsOn" value={values.endsOn} />
		</Field>
	</fieldset>

	<fieldset class="card">
		<legend><h2>{m.contract_form_approvals_legend()}</h2></legend>
		<Field
			label={m.contract_form_requires_prior_approval_label()}
			error={errors.requiresPriorApproval}
			required
		>
			<SegmentedControl
				bind:value={requiresPriorApprovalChoice}
				label={m.contract_form_requires_prior_approval_label()}
				options={[
					{
						value: 'required',
						label: m.contract_form_requires_prior_approval_required_option()
					},
					{
						value: 'not_required',
						label: m.contract_form_requires_prior_approval_not_required_option()
					}
				]}
			/>
		</Field>
		<input type="hidden" name="requiresPriorApproval" value={requiresPriorApprovalChoice} />
		<div class="approval-consequences">
			<p class:approval-consequence--active={requiresPriorApprovalChoice === 'required'}>
				{m.contract_form_requires_prior_approval_required_consequence()}
			</p>
			<p class:approval-consequence--active={requiresPriorApprovalChoice === 'not_required'}>
				{m.contract_form_requires_prior_approval_not_required_consequence()}
			</p>
		</div>
	</fieldset>

	<fieldset class="card">
		<legend><h2>{m.contract_form_payment_legend()}</h2></legend>
		<div class="grid-2">
			<Field
				label={m.contract_form_payment_terms_kind_label()}
				error={errors.paymentTermsKind}
				required
			>
				<Select name="paymentTermsKind" bind:value={paymentTermsKind} required>
					{#each paymentTermsKinds as kind (kind)}
						<option value={kind} selected={values.paymentTermsKind === kind}>
							{paymentTermsKindLabel(kind)}
						</option>
					{/each}
				</Select>
			</Field>
			{#if paymentTermsKind === 'net'}
				<Field
					label={m.contract_form_payment_terms_net_days_label()}
					error={errors.paymentTermsNetDays}
					required
				>
					<Input
						type="number"
						min="1"
						step="1"
						numeric
						name="paymentTermsNetDays"
						value={values.paymentTermsNetDays}
						required
					/>
				</Field>
			{:else}
				<Field
					label={m.contract_form_payment_terms_day_of_month_label()}
					hint={m.contract_form_payment_terms_day_of_month_hint()}
					error={errors.paymentTermsDayOfMonthDay}
					required
				>
					<Input
						type="number"
						min="1"
						max="31"
						step="1"
						numeric
						name="paymentTermsDayOfMonthDay"
						value={values.paymentTermsDayOfMonthDay}
						required
					/>
				</Field>
			{/if}
		</div>
		<div class="grid-2">
			<Field
				label={m.contract_form_invoicing_cadence_label()}
				error={errors.invoicingCadence}
				required
			>
				<Select name="invoicingCadence" value={values.invoicingCadence} required>
					{#each invoicingCadences as cadence (cadence)}
						<option value={cadence} selected={values.invoicingCadence === cadence}>
							{invoicingCadenceLabel(cadence)}
						</option>
					{/each}
				</Select>
			</Field>
			<Field label={m.contract_form_currency_label()} error={errors.currency} required>
				<Input
					name="currency"
					bind:value={currency}
					maxlength={3}
					style="text-transform: uppercase"
					required
				/>
			</Field>
		</div>
		<Field
			label={m.contract_form_tax_treatment_label()}
			hint={m.contract_form_tax_treatment_hint()}
			error={errors.taxTreatment}
			required
		>
			<Input name="taxTreatment" value={values.taxTreatment} required />
		</Field>
	</fieldset>

	<fieldset class="card">
		<legend><h2>{m.contract_form_renewal_legend()}</h2></legend>
		<Field label={m.contract_form_renewal_type_label()} error={errors.renewalType} required>
			<Select name="renewalType" bind:value={renewalType} required>
				{#each contractRenewalTypes as type (type)}
					<option value={type} selected={values.renewalType === type}>
						{renewalTypeLabel(type)}
					</option>
				{/each}
			</Select>
		</Field>
		{#if renewalType !== 'none'}
			<Field
				label={m.contract_form_renewal_notice_days_label()}
				error={errors.renewalNoticeDays}
				required
			>
				<Input
					type="number"
					min="0"
					step="1"
					numeric
					name="renewalNoticeDays"
					value={values.renewalNoticeDays}
					required
				/>
			</Field>
		{/if}
		<Field
			label={m.contract_form_termination_notice_days_label()}
			error={errors.terminationNoticeDays}
			required
		>
			<Input
				type="number"
				min="0"
				step="1"
				numeric
				name="terminationNoticeDays"
				value={values.terminationNoticeDays}
				required
			/>
		</Field>
	</fieldset>

	<fieldset class="card">
		<legend><h2>{m.contract_form_expenses_legend()}</h2></legend>
		<Field
			label={m.contract_form_expense_policy_kind_label()}
			error={errors.expensePolicyKind}
			required
		>
			<Select name="expensePolicyKind" bind:value={expensePolicyKind} required>
				{#each expensePolicyKinds as kind (kind)}
					<option value={kind} selected={values.expensePolicyKind === kind}>
						{expensePolicyKindLabel(kind)}
					</option>
				{/each}
			</Select>
		</Field>
		{#if expensePolicyKind === 'reimbursed_with_cap'}
			<AmountInput
				label={m.contract_form_expense_policy_cap_amount_label()}
				name="expensePolicyCapAmount"
				value={values.expensePolicyCapAmount}
				{currency}
				error={errors.expensePolicyCapAmount}
				required
			/>
		{/if}
		{#if expensePolicyKind !== 'not_reimbursed'}
			<Checkbox
				name="requiresExpensePreAuthorisation"
				checked={values.requiresExpensePreAuthorisation}
				label={m.contract_form_requires_expense_pre_authorisation_label()}
				error={errors.requiresExpensePreAuthorisation}
			/>
		{/if}
	</fieldset>

	<fieldset class="card">
		<legend><h2>{m.contract_form_communications_legend()}</h2></legend>
		<Field
			label={m.mail_contract_template_language_legend()}
			hint={m.contract_form_template_language_default_hint({
				client: client.legalName,
				country: clientCountryName
			})}
			error={errors.templateLanguage}
			required
		>
			<Select name="templateLanguage" value={values.templateLanguage} required>
				{#each templateLanguages as language (language)}
					<option value={language} selected={values.templateLanguage === language}>
						{language}
					</option>
				{/each}
			</Select>
		</Field>
	</fieldset>

	<Button type="submit" variant="primary">{submitLabel}</Button>
</form>

<style>
	.card {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		background: var(--surface-1);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-card);
		padding: var(--space-5);
		margin: 0;
		min-width: 0;
	}
	.card > legend {
		padding: 0;
		width: 100%;
	}
	.card h2 {
		font-size: var(--text-lg);
		font-weight: var(--weight-medium);
		color: var(--text-primary);
		margin: 0 0 calc(-1 * var(--space-1)) 0;
	}
	.grid-2 {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-4);
	}
	@media (max-width: 639px) {
		.grid-2 {
			grid-template-columns: 1fr;
		}
	}

	/* #211: both consequences of the approval decision stay visible and
	   equally muted until one is chosen — emphasis moves to the chosen
	   option's consequence afterward, but neither is ever hidden, so the
	   choice can never be made without reading what it does. */
	.approval-consequences {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.approval-consequences p {
		margin: 0;
		font-size: var(--text-xs);
		color: var(--text-muted);
	}
	.approval-consequences p.approval-consequence--active {
		color: var(--text-secondary);
		font-weight: var(--weight-medium);
	}
</style>
