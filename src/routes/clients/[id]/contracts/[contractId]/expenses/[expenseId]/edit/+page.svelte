<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { minorUnitsToDecimalString } from '$lib/money';
	import Page from '$lib/layout/Page.svelte';
	import ExpenseForm from '../../ExpenseForm.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const values = $derived(
		form?.values ?? {
			date: data.expense.date,
			description: data.expense.description,
			amount: minorUnitsToDecimalString(data.expense.amount, data.contract.currency),
			preAuthorised: data.expense.preAuthorised,
			authorisationReference: data.expense.authorisationReference ?? ''
		}
	);
</script>

<svelte:head
	><title>{m.expense_edit_page_title({ contract: data.contract.title })}</title></svelte:head
>

<Page crumbs={data.crumbs} title={m.expense_edit_heading({ contract: data.contract.title })}>
	<ExpenseForm
		{values}
		errors={form?.errors ?? {}}
		submitLabel={m.expense_form_submit_save()}
		existingReceiptName={data.existingReceiptName}
	/>
</Page>
