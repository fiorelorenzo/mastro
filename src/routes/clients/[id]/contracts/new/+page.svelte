<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import PageHeader from '$lib/nav/PageHeader.svelte';
	import ContractForm from '../ContractForm.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const values = $derived(
		form?.values ?? {
			title: '',
			signedDocumentReference: '',
			startsOn: '',
			endsOn: '',
			renewalType: 'none',
			renewalNoticeDays: '',
			terminationNoticeDays: '',
			paymentTermsKind: 'net',
			paymentTermsNetDays: '',
			paymentTermsDayOfMonthDay: '',
			invoicingCadence: 'monthly',
			currency: 'EUR',
			taxTreatment: '',
			requiresPriorApproval: false,
			expensePolicyKind: 'not_reimbursed',
			expensePolicyCapAmount: '',
			requiresExpensePreAuthorisation: false,
			templateLanguage: 'en',
			status: 'draft'
		}
	);
</script>

<svelte:head
	><title>{m.contract_new_page_title({ client: data.client.legalName })}</title></svelte:head
>

<main class="mx-auto max-w-3xl p-8">
	<PageHeader
		crumbs={data.crumbs}
		title={m.contract_new_heading({ client: data.client.legalName })}
	/>
	<ContractForm
		{values}
		errors={form?.errors ?? {}}
		submitLabel={m.contract_form_submit_create()}
	/>
</main>
