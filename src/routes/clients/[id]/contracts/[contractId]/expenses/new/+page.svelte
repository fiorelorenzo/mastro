<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import ExpenseForm from '../ExpenseForm.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const values = $derived(
		form?.values ?? {
			date: '',
			description: '',
			amount: '',
			preAuthorised: false,
			authorisationReference: ''
		}
	);
</script>

<svelte:head
	><title>{m.expense_new_page_title({ contract: data.contract.title })}</title></svelte:head
>

<main class="mx-auto max-w-3xl p-8">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-semibold">
			{m.expense_new_heading({ contract: data.contract.title })}
		</h1>
		<a
			href={resolve('/clients/[id]/contracts/[contractId]', {
				id: data.contract.clientId,
				contractId: data.contract.id
			})}
			class="text-sm underline">{m.contract_back_to_detail_link()}</a
		>
	</div>
	<ExpenseForm {values} errors={form?.errors ?? {}} submitLabel={m.expense_form_submit_create()} />
</main>
