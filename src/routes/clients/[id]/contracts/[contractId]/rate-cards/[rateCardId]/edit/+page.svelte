<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
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
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-semibold">
			{m.rate_card_edit_heading({ contract: data.contract.title })}
		</h1>
		<a
			href={resolve('/clients/[id]/contracts/[contractId]', {
				id: data.contract.clientId,
				contractId: data.contract.id
			})}
			class="text-sm underline">{m.contract_back_to_detail_link()}</a
		>
	</div>
	<RateCardForm {values} errors={form?.errors ?? {}} submitLabel={m.rate_card_form_submit_save()} />
</main>
