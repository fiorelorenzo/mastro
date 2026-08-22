<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import { formatAmount, formatDate } from '$lib/i18n/format';
	import Page from '$lib/layout/Page.svelte';
	import { Badge, EmptyState } from '$lib/design';
	import Table from '$lib/design/Table.svelte';
	import type { TableColumn } from '$lib/design/table';
	import {
		statusLabel,
		type ContractStatusValue
	} from '../clients/[id=uuid]/contracts/contract-enums';
	import { rateUnitLabel } from '../clients/[id=uuid]/contracts/[contractId=uuid]/rate-cards/rate-card-enums';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type Row = PageData['rows'][number];

	// Columns chosen for what a reader needs to decide whether to open a row,
	// not for what the table happens to have: who it is with, whether it is
	// live, what it can charge today, and whether it needs prior approval.
	const columns: readonly TableColumn<Row>[] = [
		{ key: 'title', label: m.contracts_column_contract() },
		{
			key: 'client',
			label: m.contracts_column_client(),
			format: (row) => row.clientLegalName
		},
		{ key: 'status', label: m.contracts_column_status(), cell: statusCell },
		{
			key: 'validity',
			label: m.contracts_column_validity(),
			format: (row) =>
				`${formatDate(row.startsOn)} – ${row.endsOn ? formatDate(row.endsOn) : m.rate_card_valid_to_open()}`
		},
		{ key: 'rate', label: m.contracts_column_rate(), align: 'end', cell: rateCell },
		{ key: 'approval', label: m.contracts_column_approval(), cell: approvalCell }
	];
</script>

<svelte:head><title>{m.contracts_page_title()}</title></svelte:head>

{#snippet statusCell(row: Row)}
	{#if row.status === 'active'}
		<Badge variant="good" label={statusLabel(row.status as ContractStatusValue)} size="sm" />
	{:else}
		<!--
			A status that is not active is the reason work is blocked - no day
			can be recorded, no day imported, no contract alert fires - so the
			cell that names it leads to the page that resolves it (#377). It
			was a dead badge, which is where "there is no way to change the
			status" came from: this is the screen a blocked person is sent to.
		-->
		<a
			href={resolve('/clients/[id=uuid]/contracts/[contractId=uuid]', {
				id: row.clientId,
				contractId: row.id
			})}
			title={m.contract_activate_hint()}
		>
			<Badge variant="neutral" label={statusLabel(row.status as ContractStatusValue)} size="sm" />
		</a>
	{/if}
{/snippet}

{#snippet rateCell(row: Row)}
	{#if row.rateInForce}
		{formatAmount(row.rateInForce.amount, row.currency)} / {rateUnitLabel(
			row.rateInForce.unit as Parameters<typeof rateUnitLabel>[0]
		)}
	{:else}
		<!--
			Not a blank cell: no rate card covering today means this contract
			cannot price a day at all, which is otherwise only discovered when
			recording one fails.
		-->
		<Badge variant="warning" label={m.contracts_rate_none_badge()} size="sm" />
	{/if}
{/snippet}

{#snippet approvalCell(row: Row)}
	{#if row.requiresPriorApproval}
		<Badge variant="info" label={m.contracts_approval_required_badge()} size="sm" />
	{:else}
		<span class="muted">{m.contracts_approval_not_required()}</span>
	{/if}
{/snippet}

{#snippet empty()}
	<!--
		A contract is created under the client it belongs to, so the way
		forward from here is the clients list rather than a `/contracts/new`
		this section deliberately does not own (#318's pattern: an empty state
		that offers the next step, not a grey sentence).
	-->
	<EmptyState icon="▤" title={m.contracts_empty_title()} body={m.contracts_empty_body()}>
		{#snippet actions()}
			<a href={resolve('/clients')} class="underline">{m.contracts_empty_action()}</a>
		{/snippet}
	</EmptyState>
{/snippet}

<!-- `wide`, like every other index that carries a table (#373): seven
     columns in the 48rem default wrapped the contract title onto three
     lines. `Page`'s own prop doc has the rule. -->
<Page title={m.contracts_heading()} width="wide">
	<Table
		{columns}
		rows={data.rows}
		caption={m.contracts_heading()}
		rowKey={(row) => row.id}
		rowHref={(row) =>
			resolve('/clients/[id=uuid]/contracts/[contractId=uuid]', {
				id: row.clientId,
				contractId: row.id
			})}
		{empty}
	/>
</Page>

<style>
	.muted {
		color: var(--text-secondary);
	}
</style>
