<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import PageHeader from '$lib/nav/PageHeader.svelte';
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

<main class="mx-auto max-w-3xl p-8">
	<PageHeader
		crumbs={data.crumbs}
		title={m.rate_card_new_heading({ contract: data.contract.title })}
	/>
	<RateCardForm
		{values}
		errors={form?.errors ?? {}}
		submitLabel={m.rate_card_form_submit_create()}
	/>
</main>
