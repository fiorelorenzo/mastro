<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import { minorUnitsToDecimalString } from '$lib/money';
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
					? minorUnitsToDecimalString(data.contract.expensePolicy.capAmount)
					: '',
			requiresExpensePreAuthorisation: data.contract.requiresExpensePreAuthorisation,
			status: data.contract.status
		}
	);
</script>

<svelte:head
	><title>{m.contract_edit_page_title({ title: data.contract.title })}</title></svelte:head
>

<main class="mx-auto max-w-3xl p-8">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-semibold">
			{m.contract_edit_heading({ title: data.contract.title })}
		</h1>
		<a
			href={resolve('/clients/[id]/contracts/[contractId]', {
				id: data.contract.clientId,
				contractId: data.contract.id
			})}
			class="text-sm underline">{m.contract_back_to_detail_link()}</a
		>
	</div>
	<ContractForm {values} errors={form?.errors ?? {}} submitLabel={m.contract_form_submit_save()} />
</main>
