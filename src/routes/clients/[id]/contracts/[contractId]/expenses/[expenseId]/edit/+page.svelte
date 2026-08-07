<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import { minorUnitsToDecimalString } from '$lib/money';
	import ExpenseForm from '../../ExpenseForm.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const values = $derived(
		form?.values ?? {
			date: data.expense.date,
			description: data.expense.description,
			amount: minorUnitsToDecimalString(data.expense.amount),
			preAuthorised: data.expense.preAuthorised,
			authorisationReference: data.expense.authorisationReference ?? ''
		}
	);
</script>

<svelte:head
	><title>{m.expense_edit_page_title({ contract: data.contract.title })}</title></svelte:head
>

<main class="mx-auto max-w-3xl p-8">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-semibold">
			{m.expense_edit_heading({ contract: data.contract.title })}
		</h1>
		<a
			href={resolve('/clients/[id]/contracts/[contractId]', {
				id: data.contract.clientId,
				contractId: data.contract.id
			})}
			class="text-sm underline">{m.contract_back_to_detail_link()}</a
		>
	</div>
	<ExpenseForm
		{values}
		errors={form?.errors ?? {}}
		submitLabel={m.expense_form_submit_save()}
		existingReceiptName={data.existingReceiptName}
	/>
</main>
