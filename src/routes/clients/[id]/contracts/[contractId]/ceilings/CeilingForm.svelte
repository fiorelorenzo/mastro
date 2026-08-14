<script lang="ts">
	/*
	 * CeilingForm.svelte — create/edit form for a contract-imposed ceiling
	 * (#223). AGENTS.md invariant 2: a clause capping one client's share of
	 * income belongs to the contract, not the pack — this is the interface
	 * that used to not exist, the write path (`repositories/ceiling.ts`)
	 * having shipped with #36 but no way to reach it short of SQL.
	 */
	import * as m from '$lib/paraglide/messages';
	import { ceilingBasisWords } from '$lib/dashboard/ceiling';
	import { AmountInput, Button, Field, Input, Select, Textarea } from '$lib/design';
	import type { CeilingFormValues } from '$lib/server/repositories/ceiling-form';
	import { ceilingBases, ceilingMeasureLabel, ceilingMeasures } from './ceiling-enums';

	let {
		values,
		currency,
		errors = {},
		submitLabel
	}: {
		values: CeilingFormValues;
		currency: string;
		errors?: Record<string, string>;
		submitLabel: string;
	} = $props();

	let measure = $state(values.measure);
</script>

<form method="POST" class="mt-6 flex flex-col gap-5">
	<Field
		label={m.ceiling_form_label_label()}
		hint={m.ceiling_form_label_hint()}
		error={errors.label}
		required
	>
		<Input name="label" value={values.label} required />
	</Field>

	<Field
		label={m.ceiling_form_code_label()}
		hint={m.ceiling_form_code_hint()}
		error={errors.code}
		required
	>
		<Input name="code" value={values.code} required />
	</Field>

	<div class="grid-2">
		<Field label={m.ceiling_form_measure_label()} error={errors.measure} required>
			<Select name="measure" bind:value={measure} required>
				{#each ceilingMeasures as option (option)}
					<option value={option} selected={values.measure === option}>
						{ceilingMeasureLabel(option)}
					</option>
				{/each}
			</Select>
		</Field>

		<Field label={m.ceiling_form_basis_label()} error={errors.basis} required>
			<Select name="basis" value={values.basis} required>
				<option value="" disabled>{m.ceiling_form_basis_placeholder()}</option>
				{#each ceilingBases as option (option)}
					<option value={option} selected={values.basis === option}>
						{ceilingBasisWords(option)}
					</option>
				{/each}
			</Select>
		</Field>
	</div>

	{#if measure === 'absolute_amount'}
		<AmountInput
			label={m.ceiling_form_absolute_value_label()}
			name="absoluteValue"
			value={values.absoluteValue}
			{currency}
			error={errors.absoluteValue}
			required
		/>
	{:else}
		<Field
			label={m.ceiling_form_percentage_value_label()}
			hint={m.ceiling_form_percentage_value_hint()}
			error={errors.percentageValue}
			required
		>
			<Input
				type="number"
				min="0"
				max="100"
				step="0.01"
				numeric
				name="percentageValue"
				value={values.percentageValue}
				required
			/>
		</Field>
	{/if}

	<Field
		label={m.ceiling_form_consequence_label()}
		hint={m.ceiling_form_consequence_hint()}
		error={errors.consequence}
		required
	>
		<Textarea name="consequence" value={values.consequence} rows={3} required />
	</Field>

	<Button type="submit" variant="primary">{submitLabel}</Button>
</form>

<style>
	.grid-2 {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-4);
	}
	@media (max-width: 639px) {
		.grid-2 {
			grid-template-columns: 1fr;
		}
	}
</style>
