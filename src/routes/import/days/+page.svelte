<script lang="ts">
	// The day importer (#224): a CSV or spreadsheet export, mapped columns,
	// a dry run, then a confirm — mirroring `../+page.svelte`'s stage
	// machine for the invoice importer, at a smaller scale (one file, not a
	// folder walk) since a spreadsheet export is already one flat table.
	// `idle → uploading → mapping → previewing → review → confirming →
	// done`, plus `error`. No `+page.server.ts`, same reason as the invoice
	// importer's: everything this page needs comes from `/import/days/
	// analyze` and `/import/days/confirm`, and the auth guard
	// (`hooks.server.ts`) protects the initial navigation regardless.
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import { formatDate, formatNumber } from '$lib/i18n/format';
	import {
		Amount,
		Badge,
		Banner,
		Button,
		ErrorState,
		Field,
		FileInput,
		Select,
		StatTile,
		Tabs,
		workUnitStateBadge
	} from '$lib/design';
	import Table from '$lib/design/Table.svelte';
	import type { TableColumn } from '$lib/design/table';
	import Page from '$lib/layout/Page.svelte';
	import Section from '$lib/layout/Section.svelte';
	import { dayImportFieldLabel, dayImportRejectReasonLabel } from './reject-reason';
	import type {
		DayImportAnalyzeResponse,
		DayImportColumnMapping,
		DayImportConfirmResponse,
		DayImportField,
		DayImportRejectedRow,
		DayImportReviewResponse,
		DayImportValidRow
	} from './types';

	type Stage =
		'idle' | 'uploading' | 'mapping' | 'previewing' | 'review' | 'confirming' | 'done' | 'error';

	const MAPPING_FIELDS: readonly { key: DayImportField; required: boolean }[] = [
		{ key: 'date', required: true },
		{ key: 'quantity', required: true },
		{ key: 'scope', required: true },
		{ key: 'client', required: true },
		{ key: 'contract', required: false },
		{ key: 'state', required: false }
	];

	let stage = $state<Stage>('idle');
	let errorText = $state('');
	// Kept for `previewImport`/`confirmImport`: both need the file's own
	// bytes again, and a browser `File` can be read as many times as
	// needed — re-picking the file a second time would defeat the point of
	// a review screen the reviewer can take their time on.
	let file = $state<File | null>(null);
	let headers = $state<string[]>([]);
	let sampleRows = $state<string[][]>([]);
	let mappingIndexes = $state<Record<DayImportField, string>>({
		date: '',
		quantity: '',
		scope: '',
		client: '',
		contract: '',
		state: ''
	});
	let review = $state<DayImportReviewResponse | null>(null);
	let confirmResult = $state<DayImportConfirmResponse | null>(null);

	const tabs = $derived([
		{ href: resolve('/import'), label: m.import_tab_invoices(), selected: false },
		{ href: resolve('/import/days'), label: m.import_tab_days(), selected: true }
	]);

	const mapping = $derived<DayImportColumnMapping>({
		date: mappingIndexes.date === '' ? null : Number(mappingIndexes.date),
		quantity: mappingIndexes.quantity === '' ? null : Number(mappingIndexes.quantity),
		scope: mappingIndexes.scope === '' ? null : Number(mappingIndexes.scope),
		client: mappingIndexes.client === '' ? null : Number(mappingIndexes.client),
		contract: mappingIndexes.contract === '' ? null : Number(mappingIndexes.contract),
		state: mappingIndexes.state === '' ? null : Number(mappingIndexes.state)
	});
	const mappingComplete = $derived(
		mapping.date !== null &&
			mapping.quantity !== null &&
			mapping.scope !== null &&
			mapping.client !== null
	);

	const validRows = $derived(
		(review?.outcomes.filter((outcome) => outcome.kind === 'valid') ?? []) as DayImportValidRow[]
	);
	const rejectedRows = $derived(
		(review?.outcomes.filter((outcome) => outcome.kind === 'rejected') ??
			[]) as DayImportRejectedRow[]
	);

	function reset(): void {
		stage = 'idle';
		errorText = '';
		file = null;
		headers = [];
		sampleRows = [];
		mappingIndexes = { date: '', quantity: '', scope: '', client: '', contract: '', state: '' };
		review = null;
		confirmResult = null;
	}

	function fail(error: unknown): void {
		stage = 'error';
		errorText = error instanceof Error ? error.message : String(error);
	}

	async function onFileChange(event: Event): Promise<void> {
		const input = event.currentTarget as HTMLInputElement;
		const picked = input.files?.[0] ?? null;
		input.value = '';
		if (!picked) return;
		reset();
		file = picked;
		stage = 'uploading';
		try {
			const formData = new FormData();
			formData.append('file', picked);
			const response = await fetch('/import/days/analyze', { method: 'POST', body: formData });
			if (!response.ok) {
				fail(new Error(await response.text()));
				return;
			}
			const data = (await response.json()) as DayImportAnalyzeResponse;
			if (data.kind !== 'needs_mapping') {
				fail(new Error('unexpected response from /import/days/analyze'));
				return;
			}
			headers = data.headers;
			sampleRows = data.sampleRows;
			mappingIndexes = {
				date: data.suggestedMapping.date === null ? '' : String(data.suggestedMapping.date),
				quantity:
					data.suggestedMapping.quantity === null ? '' : String(data.suggestedMapping.quantity),
				scope: data.suggestedMapping.scope === null ? '' : String(data.suggestedMapping.scope),
				client: data.suggestedMapping.client === null ? '' : String(data.suggestedMapping.client),
				contract:
					data.suggestedMapping.contract === null ? '' : String(data.suggestedMapping.contract),
				state: data.suggestedMapping.state === null ? '' : String(data.suggestedMapping.state)
			};
			stage = 'mapping';
		} catch (error) {
			fail(error);
		}
	}

	async function previewImport(): Promise<void> {
		if (!file || !mappingComplete) return;
		errorText = '';
		stage = 'previewing';
		try {
			const formData = new FormData();
			formData.append('file', file);
			formData.append('mapping', JSON.stringify(mapping));
			const response = await fetch('/import/days/analyze', { method: 'POST', body: formData });
			if (!response.ok) {
				errorText = await response.text();
				stage = 'mapping';
				return;
			}
			const data = (await response.json()) as DayImportAnalyzeResponse;
			if (data.kind !== 'review') {
				fail(new Error('unexpected response from /import/days/analyze'));
				return;
			}
			review = data;
			stage = 'review';
		} catch (error) {
			fail(error);
		}
	}

	async function confirmImport(): Promise<void> {
		if (!file) return;
		errorText = '';
		stage = 'confirming';
		try {
			const formData = new FormData();
			formData.append('file', file);
			formData.append('mapping', JSON.stringify(mapping));
			const response = await fetch('/import/days/confirm', { method: 'POST', body: formData });
			if (!response.ok) {
				errorText = await response.text();
				stage = 'review';
				return;
			}
			confirmResult = (await response.json()) as DayImportConfirmResponse;
			stage = 'done';
		} catch (error) {
			fail(error);
		}
	}
</script>

{#snippet stateCell(row: DayImportValidRow)}
	{@const badge = workUnitStateBadge(row.resultingState)}
	<Badge variant={badge.variant} label={badge.label} />
	{#if row.resultingState !== row.requestedState}
		<p class="predicted-hint">{m.import_days_state_predicted_hint()}</p>
	{/if}
{/snippet}
{#snippet amountCell(row: DayImportValidRow)}
	{#if row.previewAmount !== null}
		<Amount major={row.previewAmount} currency={row.currency} size="md" />
	{:else}
		<span>{m.day_calendar_amount_unpriced()}</span>
	{/if}
{/snippet}
{#snippet rawCell(row: DayImportRejectedRow)}
	<span class="mono">{row.raw.join(' · ')}</span>
{/snippet}
{#snippet reasonCell(row: DayImportRejectedRow)}
	{dayImportRejectReasonLabel(row.reason)}
{/snippet}
{#snippet validEmpty()}
	<p class="table-empty">{m.import_days_valid_empty()}</p>
{/snippet}
{#snippet rejectedEmpty()}
	<p class="table-empty">{m.import_days_rejected_empty()}</p>
{/snippet}

<svelte:head><title>{m.import_days_page_title()}</title></svelte:head>

<Page title={m.import_days_heading()} width="wide">
	{@const validColumns = [
		{
			key: 'row',
			label: m.import_days_column_row(),
			format: (r: DayImportValidRow) => String(r.rowNumber)
		},
		{
			key: 'date',
			label: m.day_form_date_label(),
			format: (r: DayImportValidRow) => formatDate(r.date)
		},
		{
			key: 'client',
			label: m.import_column_client(),
			format: (r: DayImportValidRow) => r.clientLegalName
		},
		{
			key: 'contract',
			label: m.day_detail_contract_label(),
			format: (r: DayImportValidRow) => r.contractTitle
		},
		{
			key: 'quantity',
			label: m.day_detail_quantity_label(),
			align: 'end' as const,
			format: (r: DayImportValidRow) => formatNumber(r.quantity)
		},
		{ key: 'scope', label: m.day_detail_scope_label(), format: (r: DayImportValidRow) => r.scope },
		{ key: 'state', label: m.day_detail_state_label(), cell: stateCell },
		{ key: 'amount', label: m.day_detail_amount_label(), align: 'end' as const, cell: amountCell }
	] satisfies TableColumn<DayImportValidRow>[]}
	{@const rejectedColumns = [
		{
			key: 'row',
			label: m.import_days_column_row(),
			format: (r: DayImportRejectedRow) => String(r.rowNumber)
		},
		{ key: 'raw', label: m.import_days_column_raw(), cell: rawCell },
		{ key: 'reason', label: m.import_column_reason(), cell: reasonCell }
	] satisfies TableColumn<DayImportRejectedRow>[]}
	<Tabs label={m.import_tabs_label()} {tabs} />
	<p class="intro">{m.import_days_intro()}</p>

	{#if errorText && stage !== 'error'}
		<Banner tone="critical">{errorText}</Banner>
	{/if}

	{#if stage === 'idle'}
		<Field label={m.import_days_file_label()}>
			<FileInput
				label={m.import_days_file_button()}
				accept=".csv,text/csv"
				onchange={onFileChange}
			/>
		</Field>
	{:else if stage === 'error'}
		<ErrorState status={500} title={m.import_days_error_title()} message={errorText}>
			{#snippet actions()}
				<Button onclick={reset}>{m.import_days_start_over_button()}</Button>
			{/snippet}
		</ErrorState>
	{:else if stage === 'uploading'}
		<p role="status">{m.import_days_uploading()}</p>
	{:else if stage === 'mapping' || stage === 'previewing'}
		<Section title={m.import_days_mapping_heading()}>
			<p class="section-hint">{m.import_days_mapping_hint()}</p>
			<div class="mapping-grid">
				{#each MAPPING_FIELDS as field (field.key)}
					<Field label={dayImportFieldLabel(field.key)} required={field.required}>
						<Select bind:value={mappingIndexes[field.key]}>
							<option value=""
								>{field.required
									? m.import_days_mapping_choose_option()
									: m.import_days_mapping_none_option()}</option
							>
							{#each headers as header, index (index)}
								<option value={String(index)}>{header}</option>
							{/each}
						</Select>
					</Field>
				{/each}
			</div>

			{#if sampleRows.length > 0}
				<div class="preview-wrapper">
					<table class="preview-table">
						<caption class="sr-only">{m.import_days_sample_caption()}</caption>
						<thead>
							<tr>
								{#each headers as header, index (index)}
									<th scope="col"
										>{header || m.import_days_column_row_index({ index: index + 1 })}</th
									>
								{/each}
							</tr>
						</thead>
						<tbody>
							{#each sampleRows as sampleRow, rowIndex (rowIndex)}
								<tr>
									{#each headers.keys() as index (index)}
										<td>{sampleRow[index] ?? ''}</td>
									{/each}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}

			<Button
				variant="primary"
				disabled={!mappingComplete || stage === 'previewing'}
				loading={stage === 'previewing'}
				onclick={previewImport}
			>
				{m.import_days_preview_button()}
			</Button>
		</Section>
	{:else if (stage === 'review' || stage === 'confirming') && review}
		<div class="stats">
			<StatTile label={m.import_days_stat_total()} value={formatNumber(review.totalRows)} />
			<StatTile label={m.import_days_stat_valid()} value={formatNumber(validRows.length)} />
			<StatTile label={m.import_days_stat_rejected()} value={formatNumber(rejectedRows.length)} />
		</div>

		<Section title={m.import_days_section_valid_heading()}>
			<Table
				columns={validColumns}
				rows={validRows}
				caption={m.import_days_section_valid_heading()}
				rowKey={(row) => String(row.rowNumber)}
				empty={validEmpty}
			/>
		</Section>

		<Section title={m.import_days_section_rejected_heading()}>
			<Table
				columns={rejectedColumns}
				rows={rejectedRows}
				caption={m.import_days_section_rejected_heading()}
				rowKey={(row) => String(row.rowNumber)}
				empty={rejectedEmpty}
			/>
		</Section>

		<div class="actions-row">
			<Button
				variant="secondary"
				onclick={() => (stage = 'mapping')}
				disabled={stage === 'confirming'}
			>
				{m.import_days_back_to_mapping_button()}
			</Button>
			<Button
				variant="primary"
				disabled={validRows.length === 0 || stage === 'confirming'}
				loading={stage === 'confirming'}
				onclick={confirmImport}
			>
				{m.import_days_confirm_button()}
			</Button>
		</div>
	{:else if stage === 'done' && confirmResult}
		<div class="stats">
			<StatTile
				label={m.import_days_stat_created()}
				value={formatNumber(confirmResult.created.length)}
			/>
			<StatTile
				label={m.import_days_stat_already_recorded()}
				value={formatNumber(confirmResult.alreadyRecorded.length)}
			/>
			<StatTile
				label={m.import_days_stat_failed()}
				value={formatNumber(confirmResult.failed.length)}
			/>
			<StatTile
				label={m.import_days_stat_rejected()}
				value={formatNumber(confirmResult.rejected.length)}
			/>
		</div>

		{#if confirmResult.failed.length > 0}
			<Banner tone="critical">
				<p>
					{m.import_days_confirm_failed_heading({
						count: formatNumber(confirmResult.failed.length)
					})}
				</p>
				<ul>
					{#each confirmResult.failed as failure (failure.rowNumber)}
						<li>{m.import_days_row_label({ rowNumber: failure.rowNumber })}: {failure.message}</li>
					{/each}
				</ul>
			</Banner>
		{/if}

		{#if confirmResult.rejected.length > 0}
			<Section title={m.import_days_section_rejected_heading()}>
				<Table
					columns={rejectedColumns}
					rows={confirmResult.rejected}
					caption={m.import_days_section_rejected_heading()}
					rowKey={(row) => String(row.rowNumber)}
					empty={rejectedEmpty}
				/>
			</Section>
		{/if}

		<Button onclick={reset}>{m.import_days_start_over_button()}</Button>
	{/if}
</Page>

<style>
	.intro {
		margin: var(--space-2) 0 var(--space-6);
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}
	.section-hint {
		margin: 0 0 var(--space-4);
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}
	.mapping-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--space-4);
		margin-bottom: var(--space-4);
	}
	@media (max-width: 639px) {
		.mapping-grid {
			grid-template-columns: 1fr;
		}
	}
	.preview-wrapper {
		overflow-x: auto;
		margin-bottom: var(--space-4);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
	}
	.preview-table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--text-sm);
	}
	.preview-table th,
	.preview-table td {
		padding: var(--space-2) var(--space-3);
		text-align: left;
		white-space: nowrap;
		border-bottom: 1px solid var(--line);
	}
	.stats {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: var(--space-4);
		margin: var(--space-4) 0 var(--space-6);
		padding: var(--space-4);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
	}
	@media (max-width: 639px) {
		.stats {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	.predicted-hint {
		margin: var(--space-1) 0 0;
		font-size: var(--text-xs);
		color: var(--text-muted);
	}
	.mono {
		font-family: var(--font-mono);
	}
	.table-empty {
		margin: 0;
		padding: var(--space-3) 0;
		font-size: var(--text-sm);
		color: var(--text-muted);
	}
	.actions-row {
		display: flex;
		gap: var(--space-3);
		margin-top: var(--space-4);
	}
</style>
