<!--
	ChaseHistory: the invoice detail page's own record of when it was
	chased and with which template (#230). A self-contained drop-in rather
	than more rows folded into the History card's `<dl>`: that card is a
	fixed two-fact sheet (issue date, then paid-on-or-due date) and a list
	of an arbitrary number of past sends — most recent first, so "when was
	this last chased" is just its own top row — is a different shape
	entirely. The page imports this straight into that same Section rather
	than opening a second "History" card.
-->
<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { formatDateTime } from '$lib/i18n/format';
	import Table from '$lib/design/Table.svelte';
	import type { TableColumn } from '$lib/design/table';

	export type ChaseHistoryRow = {
		id: string;
		sentAt: string;
		templateName: string;
		recipients: readonly string[];
	};

	let { rows }: { rows: readonly ChaseHistoryRow[] } = $props();

	const columns = [
		{
			key: 'sentAt',
			label: m.invoice_detail_chase_history_column_date(),
			format: (row) => formatDateTime(row.sentAt)
		},
		{
			key: 'templateName',
			label: m.invoice_detail_chase_history_column_template(),
			format: (row) => row.templateName
		},
		{
			key: 'recipients',
			label: m.invoice_detail_chase_history_column_recipients(),
			format: (row) => row.recipients.join(', ')
		}
	] satisfies readonly TableColumn<ChaseHistoryRow>[];
</script>

{#snippet empty()}
	<p class="empty">{m.invoice_detail_chase_history_empty()}</p>
{/snippet}

<div class="chase-history">
	<h3>{m.invoice_detail_chase_history_heading()}</h3>
	<Table
		{columns}
		{rows}
		caption={m.invoice_detail_chase_history_heading()}
		rowKey={(row) => row.id}
		{empty}
		density="compact"
	/>
</div>

<style>
	.chase-history {
		margin-top: var(--space-4);
	}
	h3 {
		margin: 0 0 var(--space-2);
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		color: var(--text-secondary);
	}
	.empty {
		margin: 0;
		font-size: var(--text-sm);
		font-style: italic;
		color: var(--text-muted);
	}
</style>
