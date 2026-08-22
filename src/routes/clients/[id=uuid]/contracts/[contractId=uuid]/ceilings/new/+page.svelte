<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import Page from '$lib/layout/Page.svelte';
	import CeilingForm from '../CeilingForm.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const values = $derived(
		form?.values ?? {
			code: '',
			label: '',
			measure: 'absolute_amount',
			absoluteValue: '',
			percentageValue: '',
			basis: '',
			consequence: ''
		}
	);
</script>

<svelte:head
	><title>{m.contract_ceiling_new_page_title({ contract: data.contract.title })}</title
	></svelte:head
>

<Page
	crumbs={data.crumbs}
	title={m.contract_ceiling_new_heading({ contract: data.contract.title })}
>
	<CeilingForm
		{values}
		currency={data.contract.currency}
		errors={form?.errors ?? {}}
		submitLabel={m.ceiling_form_submit_create()}
	/>
</Page>
