<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
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
			status: 'draft'
		}
	);
</script>

<svelte:head
	><title>{m.contract_new_page_title({ client: data.client.legalName })}</title></svelte:head
>

<main class="mx-auto max-w-3xl p-8">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-semibold">
			{m.contract_new_heading({ client: data.client.legalName })}
		</h1>
		<a href={resolve('/clients/[id]', { id: data.client.id })} class="text-sm underline"
			>{m.contract_back_to_client_link()}</a
		>
	</div>
	<ContractForm
		{values}
		errors={form?.errors ?? {}}
		submitLabel={m.contract_form_submit_create()}
	/>
</main>
