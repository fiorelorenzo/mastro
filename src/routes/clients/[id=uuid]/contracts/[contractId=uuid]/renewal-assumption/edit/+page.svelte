<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { minorUnitsToDecimalString } from '$lib/money';
	import { AmountInput, Button, Field, Input } from '$lib/design';
	import { submitting } from '$lib/design/submitting.svelte';
	import Page from '$lib/layout/Page.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const save = submitting();
	const remove = submitting();

	const values = $derived(
		form?.values ?? {
			probability: data.assumption ? String(data.assumption.probability * 100) : '',
			expectedVolume: data.assumption
				? minorUnitsToDecimalString(
						data.assumption.expectedVolumeMinorUnits,
						data.contract.currency
					)
				: '',
			horizonEndsOn: data.assumption?.horizonEndsOn ?? ''
		}
	);
</script>

<svelte:head><title>{m.renewal_assumption_edit_page_title()}</title></svelte:head>

<Page
	crumbs={data.crumbs}
	title={m.renewal_assumption_edit_heading({ contract: data.contract.title })}
>
	<form method="POST" class="mt-6 flex flex-col gap-5" onsubmit={save.onsubmit}>
		<Field
			label={m.renewal_assumption_probability_label()}
			hint={m.renewal_assumption_probability_hint()}
			error={form?.errors?.probability}
			required
		>
			<Input
				type="number"
				min="0"
				max="100"
				step="0.01"
				numeric
				name="probability"
				value={values.probability}
				required
			/>
		</Field>

		<AmountInput
			label={m.renewal_assumption_expected_volume_label()}
			name="expectedVolume"
			value={values.expectedVolume}
			currency={data.contract.currency}
			error={form?.errors?.expectedVolume}
			required
		/>

		<Field
			label={m.renewal_assumption_horizon_label()}
			hint={m.renewal_assumption_horizon_hint()}
			error={form?.errors?.horizonEndsOn}
			required
		>
			<Input type="date" name="horizonEndsOn" value={values.horizonEndsOn} required />
		</Field>

		<Button type="submit" variant="primary" loading={save.busy}
			>{m.renewal_assumption_submit_save()}</Button
		>
	</form>

	{#if data.assumption}
		<form method="POST" action="?/delete" class="mt-4" onsubmit={remove.onsubmit}>
			<Button type="submit" variant="tertiary" size="sm" loading={remove.busy}>
				{m.renewal_assumption_delete_submit()}
			</Button>
		</form>
	{/if}
</Page>
