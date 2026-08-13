<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import Page from '$lib/layout/Page.svelte';
	import ContractForm from '../ContractForm.svelte';
	import { defaultTemplateLanguageForCountry } from '../contract-enums';
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
			// #211: no silent default — nothing chosen until the person picks
			// one of the SegmentedControl's two options (see ContractForm.svelte).
			requiresPriorApproval: null,
			expensePolicyKind: 'not_reimbursed',
			expensePolicyCapAmount: '',
			requiresExpensePreAuthorisation: false,
			templateLanguage: defaultTemplateLanguageForCountry(data.client.country),
			// #211: a contract created here is usable immediately. `day/new`'s
			// own loader (loadActiveContracts) only ever offers `active`
			// contracts, so a `draft` default made every new contract invisible
			// to day recording until someone noticed and edited it back —
			// `buildClientContractProposal` (import/client-match.ts) already
			// creates its derived contracts `active` for the same reason.
			// `draft` stays a real, selectable status for a contract that
			// genuinely isn't ready yet; it is just no longer what a person
			// gets without asking for it.
			status: 'active'
		}
	);
</script>

<svelte:head
	><title>{m.contract_new_page_title({ client: data.client.legalName })}</title></svelte:head
>

<Page crumbs={data.crumbs} title={m.contract_new_heading({ client: data.client.legalName })}>
	<ContractForm
		{values}
		client={data.client}
		errors={form?.errors ?? {}}
		submitLabel={m.contract_form_submit_create()}
	/>
</Page>
