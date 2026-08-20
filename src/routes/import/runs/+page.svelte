<!--
	The extraction runs registry (#278,
	`docs/specs/2026-08-15-extraction-runs-design.md`, "The registry (C)"):
	every extraction job the agent has ever run, newest first, so a
	document that keeps failing every five minutes is visible instead of
	silently retried off-screen — the exact incident the design doc opens
	with. No tabs, no filter: the registry is meant to be short enough to
	read in full, and a failure anywhere in it is the thing worth seeing
	regardless of how old it is.
-->
<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import { formatDuration } from '$lib/i18n/format';
	import { Badge, EmptyState } from '$lib/design';
	import Table from '$lib/design/Table.svelte';
	import type { TableColumn } from '$lib/design/table';
	import Page from '$lib/layout/Page.svelte';
	import { runDurationSeconds, runStatusBadge, targetTypeLabel } from './run-status';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type Row = PageData['runs'][number];
</script>

<svelte:head><title>{m.extraction_run_registry_page_title()}</title></svelte:head>

{#snippet statusCell(row: Row)}
	{@const status = runStatusBadge(row.status)}
	<Badge variant={status.variant} label={status.label} />
{/snippet}
{#snippet outcomeCell(row: Row)}
	{#if row.status === 'applied' && row.proposalId}
		<a href={resolve('/proposals/[id]', { id: row.proposalId })}>
			{m.extraction_run_registry_outcome_view_proposal()}
		</a>
	{:else if row.status === 'nothing_proposed'}
		<!-- #398: an em dash here would read as "we have no idea", when the run
		     has a definite answer: the message was read and approved no day.
		     Worth a sentence, because this is the outcome a reader is most
		     likely to mistake for a failure. -->
		<span class="muted">{m.extraction_run_detail_outcome_nothing_proposed()}</span>
	{:else if row.status === 'failed' && row.error}
		<span class="outcome-error">{row.error}</span>
	{:else}
		<span class="muted">—</span>
	{/if}
{/snippet}
{#snippet empty()}
	<EmptyState
		icon="⟳"
		title={m.extraction_run_registry_empty_title()}
		body={m.extraction_run_registry_empty_body()}
	/>
{/snippet}

<Page
	title={m.extraction_run_registry_heading()}
	subtitle={m.extraction_run_registry_subtitle()}
	width="wide"
>
	{@const columns = [
		{
			key: 'document',
			label: m.extraction_run_registry_column_document(),
			format: (row) => row.documentOriginalName ?? m.extraction_run_registry_document_unknown()
		},
		{
			key: 'targetType',
			label: m.extraction_run_registry_column_target_type(),
			format: (row) => targetTypeLabel(row.targetType)
		},
		{ key: 'status', label: m.extraction_run_registry_column_status(), cell: statusCell },
		{
			key: 'duration',
			label: m.extraction_run_registry_column_duration(),
			align: 'end',
			format: (row) => formatDuration(runDurationSeconds(row))
		},
		{ key: 'outcome', label: m.extraction_run_registry_column_outcome(), cell: outcomeCell }
	] satisfies readonly TableColumn<Row>[]}

	<Table
		{columns}
		rows={data.runs}
		caption={m.extraction_run_registry_heading()}
		rowKey={(row) => row.id}
		rowHref={(row) => `/import/runs/${row.id}`}
		{empty}
	/>
</Page>

<style>
	.outcome-error {
		display: inline-block;
		max-width: 32ch;
		overflow: hidden;
		color: var(--color-danger);
		text-overflow: ellipsis;
		white-space: nowrap;
		vertical-align: bottom;
	}
	.muted {
		color: var(--text-muted);
	}
</style>
