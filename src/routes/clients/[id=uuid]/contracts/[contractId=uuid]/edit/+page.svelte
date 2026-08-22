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
			appliesSocialCharge: data.contract.appliesSocialCharge,
			templateLanguage: data.contract.templateLanguage,
			status: data.contract.status
		}
	);
</script>

<svelte:head
	><title>{m.contract_edit_page_title({ title: data.contract.title })}</title></svelte:head
>

<Page crumbs={data.crumbs} title={m.contract_edit_heading({ title: data.contract.title })}>
	<ContractForm
		{values}
		client={data.contract.client}
		errors={form?.errors ?? {}}
		submitLabel={m.contract_form_submit_save()}
		socialChargeLabel={data.socialChargeLabel}
	/>
</Page>
