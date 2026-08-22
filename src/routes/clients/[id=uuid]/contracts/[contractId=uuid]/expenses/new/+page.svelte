<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import Page from '$lib/layout/Page.svelte';
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

<Page crumbs={data.crumbs} title={m.expense_new_heading({ contract: data.contract.title })}>
	<ExpenseForm {values} errors={form?.errors ?? {}} submitLabel={m.expense_form_submit_create()} />
</Page>
