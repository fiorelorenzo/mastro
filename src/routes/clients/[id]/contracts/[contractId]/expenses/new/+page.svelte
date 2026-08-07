<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import PageHeader from '$lib/nav/PageHeader.svelte';
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
	<PageHeader
		crumbs={data.crumbs}
		title={m.expense_new_heading({ contract: data.contract.title })}
	/>
	<ExpenseForm {values} errors={form?.errors ?? {}} submitLabel={m.expense_form_submit_create()} />
</main>
