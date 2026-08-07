<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import Page from '$lib/layout/Page.svelte';
	import RateCardForm from '../RateCardForm.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const values = $derived(
		form?.values ?? {
			validFrom: '',
			validTo: '',
			kind: 'daily',
			amount: '',
			unit: 'day',
			allowedFractions: '1',
			minimumHours: '',
			disbursementPeriod: ''
		}
	);
</script>

<svelte:head
	><title>{m.rate_card_new_page_title({ contract: data.contract.title })}</title></svelte:head
>

<Page crumbs={data.crumbs} title={m.rate_card_new_heading({ contract: data.contract.title })}>
	<RateCardForm
		{values}
		errors={form?.errors ?? {}}
		submitLabel={m.rate_card_form_submit_create()}
	/>
</Page>
