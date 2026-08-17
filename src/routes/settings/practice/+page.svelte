<script lang="ts">
	/*
	 * The practice's own fiscal identity (#258): legal name, tax id, VAT
	 * id and registered address — the issuer block a generated invoice
	 * needs on the practice's own side. One singleton row, edited in
	 * place; the form doubles as create-or-edit since there is never a
	 * second one to create.
	 *
	 * `data.profile` is `null` on a fresh instance. That case gets its own
	 * visible banner rather than a form that just happens to render with
	 * every field blank — the acceptance criterion this page exists to
	 * satisfy (#258: "never a silent null used downstream").
	 */
	import * as m from '$lib/paraglide/messages';
	import { getLocale } from '$lib/paraglide/runtime';
	import { Banner, Button, Field, Input, Select, countryOptions } from '$lib/design';
	import Page from '$lib/layout/Page.svelte';
	import { submitting } from '$lib/design/submitting.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const save = submitting();

	const errors = $derived(form?.errors ?? {});
	const values = $derived(
		form?.values ??
			(data.profile
				? {
						legalName: data.profile.legalName,
						taxId: data.profile.taxId,
						vatId: data.profile.vatId ?? '',
						country: data.profile.country,
						addressLine1: data.profile.addressLine1,
						addressLine2: data.profile.addressLine2 ?? '',
						addressCity: data.profile.addressCity,
						addressPostalCode: data.profile.addressPostalCode,
						addressRegion: data.profile.addressRegion ?? ''
					}
				: {
						legalName: '',
						taxId: '',
						vatId: '',
						country: '',
						addressLine1: '',
						addressLine2: '',
						addressCity: '',
						addressPostalCode: '',
						addressRegion: ''
					})
	);

	const countries = $derived(countryOptions(getLocale()));
</script>

<svelte:head><title>{m.settings_practice_page_title()}</title></svelte:head>

<Page title={m.settings_practice_heading()} crumbs={data.crumbs}>
	{#if !data.profile}
		<Banner tone="warning">
			{m.settings_practice_empty_notice()}
		</Banner>
	{/if}

	<form method="POST" class="mt-6 flex flex-col gap-5" onsubmit={save.onsubmit}>
		<fieldset class="card">
			<legend><h2>{m.settings_practice_legal_identity_legend()}</h2></legend>
			<Field label={m.settings_practice_legal_name_label()} error={errors.legalName} required>
				<Input name="legalName" value={values.legalName} required />
			</Field>
			<Field label={m.settings_practice_country_label()} error={errors.country} required>
				<Select name="country" value={values.country} required>
					<option value="" disabled selected={values.country === ''}>
						{m.settings_practice_country_placeholder()}
					</option>
					{#each countries as country (country.code)}
						<option value={country.code} selected={values.country === country.code}>
							{country.name}
						</option>
					{/each}
				</Select>
			</Field>
			<div class="grid-2">
				<Field label={m.settings_practice_tax_id_label()} error={errors.taxId} required>
					<Input name="taxId" value={values.taxId} required />
				</Field>
				<Field label={m.settings_practice_vat_id_label()} error={errors.vatId}>
					<Input name="vatId" value={values.vatId} />
				</Field>
			</div>
		</fieldset>

		<fieldset class="card">
			<legend><h2>{m.settings_practice_address_legend()}</h2></legend>
			<Field label={m.settings_practice_address_line1_label()} error={errors.addressLine1} required>
				<Input name="addressLine1" value={values.addressLine1} required />
			</Field>
			<Field label={m.settings_practice_address_line2_label()} error={errors.addressLine2}>
				<Input name="addressLine2" value={values.addressLine2} />
			</Field>
			<div class="grid-2">
				<Field label={m.settings_practice_city_label()} error={errors.addressCity} required>
					<Input name="addressCity" value={values.addressCity} required />
				</Field>
				<Field
					label={m.settings_practice_postal_code_label()}
					error={errors.addressPostalCode}
					required
				>
					<Input name="addressPostalCode" value={values.addressPostalCode} required />
				</Field>
			</div>
			<Field label={m.settings_practice_region_label()} error={errors.addressRegion}>
				<Input name="addressRegion" value={values.addressRegion} />
			</Field>
		</fieldset>

		<Button type="submit" variant="primary" loading={save.busy}
			>{m.settings_practice_submit_save()}</Button
		>
	</form>
</Page>

<style>
	.card {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		background: var(--surface-1);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-card);
		padding: var(--space-5);
		margin: 0;
		min-width: 0;
	}
	.card > legend {
		padding: 0;
		width: 100%;
	}
	.card h2 {
		font-size: var(--text-lg);
		font-weight: var(--weight-medium);
		color: var(--text-primary);
		margin: 0 0 calc(-1 * var(--space-1)) 0;
	}
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
