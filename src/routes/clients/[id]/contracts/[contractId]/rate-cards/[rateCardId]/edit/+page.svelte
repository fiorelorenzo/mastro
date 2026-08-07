<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import PageHeader from '$lib/nav/PageHeader.svelte';
	import RateCardForm from '../../RateCardForm.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const values = $derived(
		form?.values ?? {
			validFrom: data.rateCard.validFrom,
			validTo: data.rateCard.validTo ?? '',
			kind: data.rateCard.kind,
			amount: data.rateCard.amount.toString(),
			unit: data.rateCard.unit,
			allowedFractions: data.rateCard.allowedFractions.join(', '),
			minimumHours: data.rateCard.minimumHours?.toString() ?? '',
			disbursementPeriod: data.rateCard.disbursementPeriod ?? ''
		}
	);
</script>

<svelte:head
	><title>{m.rate_card_edit_page_title({ contract: data.contract.title })}</title></svelte:head
>

<main class="mx-auto max-w-3xl p-8">
	<PageHeader
		crumbs={data.crumbs}
		title={m.rate_card_edit_heading({ contract: data.contract.title })}
	/>
	<RateCardForm {values} errors={form?.errors ?? {}} submitLabel={m.rate_card_form_submit_save()} />
</main>
