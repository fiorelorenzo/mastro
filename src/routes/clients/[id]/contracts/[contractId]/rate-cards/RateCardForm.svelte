<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { Button, Field, Select } from '$lib/design';
	import { submitting } from '$lib/design/submitting.svelte';
	import type { RateCardFormValues } from '$lib/server/repositories/rate-card-form';
	import {
		disbursementPeriods,
		rateCardKinds,
		rateUnits,
		disbursementPeriodLabel,
		rateCardKindLabel,
		rateUnitLabel
	} from './rate-card-enums';

	let {
		values,
		errors = {},
		submitLabel
	}: {
		values: RateCardFormValues;
		errors?: Record<string, string>;
		submitLabel: string;
	} = $props();

	// Drives which kind-specific fields show below — same select-driven
	// pattern as `ContractForm.svelte`/`CeilingForm.svelte`, and left alone
	// by a background `invalidateAll()` for the same reason: it is the
	// reviewer's own in-progress choice, and this form's own submit (plain
	// POST, no `use:enhance`) already remounts with fresh `values`.
	let kind = $state(values.kind);
	const save = submitting();
</script>

<form method="POST" class="mt-6 flex flex-col gap-3" onsubmit={save.onsubmit}>
	<label class="flex flex-col gap-1 text-sm">
		{m.rate_card_form_valid_from_label()}
		<input
			type="date"
			name="validFrom"
			value={values.validFrom}
			class="border px-2 py-1"
			required
		/>
		{#if errors.validFrom}<span class="text-xs font-semibold">{errors.validFrom}</span>{/if}
	</label>
	<label class="flex flex-col gap-1 text-sm">
		{m.rate_card_form_valid_to_label()}
		<input type="date" name="validTo" value={values.validTo} class="border px-2 py-1" />
		<span class="text-xs opacity-70">{m.rate_card_form_valid_to_hint()}</span>
		{#if errors.validTo}<span class="text-xs font-semibold">{errors.validTo}</span>{/if}
	</label>
	<Field label={m.rate_card_form_kind_label()} error={errors.kind} required>
		<Select name="kind" bind:value={kind} required>
			{#each rateCardKinds as candidate (candidate)}
				<option value={candidate} selected={values.kind === candidate}>
					{rateCardKindLabel(candidate)}
				</option>
			{/each}
		</Select>
	</Field>
	<label class="flex flex-col gap-1 text-sm">
		{m.rate_card_form_amount_label()}
		<input name="amount" value={values.amount} class="border px-2 py-1" required />
		{#if errors.amount}<span class="text-xs font-semibold">{errors.amount}</span>{/if}
	</label>
	<Field label={m.rate_card_form_unit_label()} error={errors.unit} required>
		<Select name="unit" value={values.unit} required>
			{#each rateUnits as unit (unit)}
				<option value={unit} selected={values.unit === unit}>{rateUnitLabel(unit)}</option>
			{/each}
		</Select>
	</Field>
	<label class="flex flex-col gap-1 text-sm">
		{m.rate_card_form_allowed_fractions_label()}
		<input
			name="allowedFractions"
			value={values.allowedFractions}
			class="border px-2 py-1"
			required
		/>
		<span class="text-xs opacity-70">{m.rate_card_form_allowed_fractions_hint()}</span>
		{#if errors.allowedFractions}<span class="text-xs font-semibold">{errors.allowedFractions}</span
			>{/if}
	</label>
	{#if kind === 'hourly'}
		<label class="flex flex-col gap-1 text-sm">
			{m.rate_card_form_minimum_hours_label()}
			<input name="minimumHours" value={values.minimumHours} class="border px-2 py-1" />
			{#if errors.minimumHours}<span class="text-xs font-semibold">{errors.minimumHours}</span>{/if}
		</label>
	{/if}
	{#if kind === 'fixed_recurring'}
		<Field
			label={m.rate_card_form_disbursement_period_label()}
			error={errors.disbursementPeriod}
			required
		>
			<Select name="disbursementPeriod" value={values.disbursementPeriod} required>
				<option value="" disabled selected={values.disbursementPeriod === ''}>
					{m.rate_card_form_disbursement_period_placeholder()}
				</option>
				{#each disbursementPeriods as period (period)}
					<option value={period} selected={values.disbursementPeriod === period}>
						{disbursementPeriodLabel(period)}
					</option>
				{/each}
			</Select>
		</Field>
	{/if}

	<Button type="submit" variant="secondary" size="md" loading={save.busy}>{submitLabel}</Button>
</form>
