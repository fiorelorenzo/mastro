<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { getLocale } from '$lib/paraglide/runtime';
	import { minorUnitsToDecimalString } from '$lib/money';
	import Page from '$lib/layout/Page.svelte';
	import CeilingForm from '../../CeilingForm.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const locale = $derived(getLocale());

	const values = $derived(
		form?.values ?? {
			code: data.ceiling.code,
			label: data.ceiling.label[locale],
			measure: data.ceiling.measure,
			absoluteValue:
				data.ceiling.measure === 'absolute_amount' && data.ceiling.absoluteValueMinorUnits !== null
					? minorUnitsToDecimalString(data.ceiling.absoluteValueMinorUnits, data.contract.currency)
					: '',
			percentageValue:
				data.ceiling.measure === 'percentage_share' && data.ceiling.shareRatio !== null
					? String(data.ceiling.shareRatio * 100)
					: '',
			basis: data.ceiling.basis,
			consequence: data.ceiling.consequence[locale]
		}
	);
</script>

<svelte:head
	><title>{m.contract_ceiling_edit_page_title({ contract: data.contract.title })}</title
	></svelte:head
>

<Page
	crumbs={data.crumbs}
	title={m.contract_ceiling_edit_heading({ contract: data.contract.title })}
>
	<CeilingForm
		{values}
		currency={data.contract.currency}
		errors={form?.errors ?? {}}
		submitLabel={m.ceiling_form_submit_save()}
	/>
</Page>
