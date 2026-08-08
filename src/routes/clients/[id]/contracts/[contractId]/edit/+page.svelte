<script lang="ts">
	import { minorUnitsToDecimalString } from '$lib/money';
	import * as m from '$lib/paraglide/messages';
	import Page from '$lib/layout/Page.svelte';
	import ContractForm from '../../ContractForm.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const values = $derived(
		form?.values ?? {
			title: data.contract.title,
			signedDocumentReference: data.contract.signedDocumentReference ?? '',
			startsOn: data.contract.startsOn,
			endsOn: data.contract.endsOn ?? '',
			renewalType: data.contract.renewalType,
			renewalNoticeDays: data.contract.renewalNoticeDays?.toString() ?? '',
			terminationNoticeDays: data.contract.terminationNoticeDays.toString(),
			paymentTermsKind: data.contract.paymentTerms.kind,
			paymentTermsNetDays:
				data.contract.paymentTerms.kind === 'net' ? data.contract.paymentTerms.days.toString() : '',
			paymentTermsDayOfMonthDay:
				data.contract.paymentTerms.kind === 'day_of_month'
					? data.contract.paymentTerms.day.toString()
					: '',
			invoicingCadence: data.contract.invoicingCadence,
			currency: data.contract.currency,
			taxTreatment: data.contract.taxTreatment,
			requiresPriorApproval: data.contract.requiresPriorApproval,
			expensePolicyKind: data.contract.expensePolicy.kind,
			expensePolicyCapAmount:
				data.contract.expensePolicy.kind === 'reimbursed_with_cap'
					? minorUnitsToDecimalString(data.contract.expensePolicy.capAmount, data.contract.currency)
					: '',
			requiresExpensePreAuthorisation: data.contract.requiresExpensePreAuthorisation,
			templateLanguage: data.contract.templateLanguage,
			status: data.contract.status
		}
	);
</script>

<svelte:head
	><title>{m.contract_edit_page_title({ title: data.contract.title })}</title></svelte:head
>

<Page crumbs={data.crumbs} title={m.contract_edit_heading({ title: data.contract.title })}>
	<ContractForm {values} errors={form?.errors ?? {}} submitLabel={m.contract_form_submit_save()} />

	<section class="mt-10 flex flex-col gap-3 border-t pt-6">
		<h2 class="text-lg font-semibold">{m.contract_hosted_extraction_consent_heading()}</h2>
		<p class="text-sm opacity-70">{m.contract_hosted_extraction_consent_hint()}</p>
		{#if data.hostedExtractionConsentDocument}
			<p class="text-sm">
				{m.contract_hosted_extraction_consent_on_file({
					name: data.hostedExtractionConsentDocument.originalName
				})}
			</p>
			<form method="POST" action="?/revokeConsent">
				<button type="submit" class="w-fit border px-4 py-2 text-sm"
					>{m.contract_hosted_extraction_consent_revoke_button()}</button
				>
			</form>
		{:else}
			<p class="text-sm opacity-70">{m.contract_hosted_extraction_consent_none_on_file()}</p>
			<form
				method="POST"
				action="?/consent"
				enctype="multipart/form-data"
				class="flex flex-col gap-2"
			>
				<label class="flex flex-col gap-1 text-sm">
					{m.contract_hosted_extraction_consent_file_label()}
					<input type="file" name="hostedExtractionConsentDocument" class="border px-2 py-1" />
				</label>
				{#if form?.consentError}
					<span class="text-xs font-semibold">{form.consentError}</span>
				{/if}
				<button type="submit" class="w-fit border px-4 py-2 text-sm"
					>{m.contract_hosted_extraction_consent_submit_button()}</button
				>
			</form>
		{/if}
	</section>
</Page>
