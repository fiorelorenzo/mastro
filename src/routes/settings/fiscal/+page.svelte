<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { getLocale } from '$lib/paraglide/runtime';
	import { formatDate, formatMinorUnits, formatPercent } from '$lib/i18n/format';
	import { ceilingBasisWords } from '$lib/dashboard/ceiling';
	import { Button, EmptyState, Field, Input, Select } from '$lib/design';
	import Table from '$lib/design/Table.svelte';
	import type { TableColumn } from '$lib/design/table';
	import Card from '$lib/layout/Card.svelte';
	import Page from '$lib/layout/Page.svelte';
	import Section from '$lib/layout/Section.svelte';
	import type { MinorUnits } from '$lib/money';
	import type { CeilingBasis, CeilingMeasure } from '$lib/server/fiscal/pack';
	import type { LabelBundle } from '$lib/server/fiscal/label';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const locale = $derived(getLocale());

	// The fiscal engine carries no currency of its own — every pack ceiling
	// is denominated in EUR, the same hardcoded reading the dashboard's own
	// ceiling meter uses (`$lib/dashboard/ceiling.ts`).
	const CURRENCY = 'EUR';

	type HistoryRow = PageData['history'][number];

	const values = $derived(form?.values ?? { packKey: '', validFrom: '', validTo: '' });
	let packKey = $state(values.packKey);

	const selectedPack = $derived(data.packs.find((pack) => pack.key === packKey) ?? null);

	function historyValidity(row: HistoryRow): string {
		const from = formatDate(row.validFrom, locale);
		const to = row.validTo
			? formatDate(row.validTo, locale)
			: m.settings_fiscal_history_valid_to_open();
		return `${from} – ${to}`;
	}
</script>

{#snippet ceilingList(
	ceilings: readonly {
		id: string;
		label: LabelBundle;
		measure: CeilingMeasure;
		value: number;
		basis: CeilingBasis;
	}[]
)}
	<ul class="ceiling-list">
		{#each ceilings as ceiling (ceiling.id)}
			<li>
				<span class="ceiling-label">{ceiling.label[locale]}</span>
				<span class="ceiling-value">
					{ceiling.measure === 'absolute_amount'
						? formatMinorUnits(ceiling.value as MinorUnits, CURRENCY, locale)
						: formatPercent(ceiling.value, locale)}
				</span>
				<span class="ceiling-basis">{ceilingBasisWords(ceiling.basis)}</span>
			</li>
		{/each}
	</ul>
{/snippet}

{#snippet historyEmpty()}
	<EmptyState
		icon="🗓"
		title={m.settings_fiscal_history_heading()}
		body={m.settings_fiscal_history_empty()}
	/>
{/snippet}

<svelte:head><title>{m.settings_fiscal_page_title()}</title></svelte:head>

<Page title={m.settings_fiscal_heading()} crumbs={data.crumbs}>
	<Section title={m.settings_fiscal_current_heading()}>
		{#if data.current}
			<Card>
				<p class="current-summary">
					{m.settings_fiscal_active({
						pack: data.current.pack.displayName[locale],
						date: formatDate(data.current.validFrom, locale)
					})}
				</p>
				<h3 class="ceilings-heading">{m.settings_fiscal_current_ceilings_heading()}</h3>
				{#if data.current.pack.ceilings.length === 0}
					<p class="muted">{m.settings_fiscal_current_ceilings_none()}</p>
				{:else}
					{@render ceilingList(data.current.pack.ceilings)}
				{/if}
			</Card>
		{:else}
			<EmptyState
				icon="⚖"
				title={m.settings_fiscal_current_heading()}
				body={m.settings_fiscal_none()}
			/>
		{/if}
	</Section>

	{@const historyColumns = [
		{
			key: 'pack',
			label: m.settings_fiscal_history_column_pack(),
			format: (row: HistoryRow) => row.displayName[locale]
		},
		{
			key: 'validity',
			label: m.settings_fiscal_history_column_validity(),
			format: historyValidity
		}
	] satisfies readonly TableColumn<HistoryRow>[]}

	<Section title={m.settings_fiscal_history_heading()}>
		<Table
			columns={historyColumns}
			rows={data.history}
			caption={m.settings_fiscal_history_heading()}
			rowKey={(row) => row.id}
			empty={historyEmpty}
		/>
	</Section>

	<Section
		title={data.current
			? m.settings_fiscal_form_heading_switch()
			: m.settings_fiscal_form_heading_initial()}
	>
		<form method="POST" class="mt-6 flex flex-col gap-5">
			<Field label={m.settings_fiscal_form_pack_label()} error={form?.errors?.packKey} required>
				<Select name="packKey" bind:value={packKey} required>
					<option value="" disabled>{m.settings_fiscal_form_pack_placeholder()}</option>
					{#each data.packs as pack (pack.key)}
						<option value={pack.key} selected={values.packKey === pack.key}>
							{pack.displayName[locale]}
						</option>
					{/each}
				</Select>
			</Field>

			<Field
				label={m.settings_fiscal_form_valid_from_label()}
				hint={data.current
					? m.settings_fiscal_form_valid_from_hint_switch()
					: m.settings_fiscal_form_valid_from_hint_initial()}
				error={form?.errors?.validFrom}
				required
			>
				<Input type="date" name="validFrom" value={values.validFrom} required />
			</Field>

			<Field
				label={m.settings_fiscal_form_valid_to_label()}
				hint={m.settings_fiscal_form_valid_to_hint()}
				error={form?.errors?.validTo}
			>
				<Input type="date" name="validTo" value={values.validTo} />
			</Field>

			{#if selectedPack}
				<div class="preview">
					<h3 class="ceilings-heading">{m.settings_fiscal_form_preview_heading()}</h3>
					{#if selectedPack.ceilings.length === 0}
						<p class="muted">{m.settings_fiscal_form_preview_none()}</p>
					{:else}
						{@render ceilingList(selectedPack.ceilings)}
					{/if}
				</div>
			{/if}

			<Button type="submit" variant="primary">{m.settings_fiscal_form_submit()}</Button>
		</form>
	</Section>
</Page>

<style>
	.current-summary {
		font-size: var(--text-md);
	}
	.ceilings-heading {
		margin-top: var(--space-4);
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		color: var(--text-secondary);
	}
	.muted {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.ceiling-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin-top: var(--space-2);
		padding: 0;
		list-style: none;
	}
	.ceiling-list li {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-2);
		font-size: var(--text-sm);
	}
	.ceiling-label {
		font-weight: var(--weight-medium);
	}
	.ceiling-value {
		font-variant-numeric: tabular-nums;
	}
	.ceiling-basis {
		color: var(--text-muted);
	}
	.preview {
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-md);
		padding: var(--space-3) var(--space-4);
	}
</style>
