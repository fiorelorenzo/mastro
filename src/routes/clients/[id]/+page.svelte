<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import {
		formatAmount,
		formatDate,
		formatDays,
		formatMinorUnits,
		formatPercent
	} from '$lib/i18n/format';
	import { factLine } from '$lib/nav/crumbs';
	import Page from '$lib/layout/Page.svelte';
	import Section from '$lib/layout/Section.svelte';
	import RecordList from '$lib/layout/RecordList.svelte';
	import type { RecordColumn } from '$lib/layout/types';
	import { Badge, Banner, EmptyState, StatTile } from '$lib/design';
	import { clientFieldLabel } from '$lib/i18n/client-fields';
	import { appHref } from '$lib/nav/href';
	import { noticeChannelLabel } from '../notice-channel';
	import { concentrationBadge } from '../concentration-badge';
	import { renewalTypeLabel, statusLabel } from './contracts/contract-enums';
	import {
		disbursementPeriodLabel,
		rateUnitLabel
	} from './contracts/[contractId]/rate-cards/rate-card-enums';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// The fiscal engine carries no currency of its own (`fiscal/ledger.ts`'s
	// `LedgerRow`); every contract in this codebase is EUR, the same
	// assumption the client list and the dashboard already make.
	const CURRENCY = 'EUR';

	const cap = $derived(data.exposure.concentrationCap);
	const capBadge = $derived(concentrationBadge(cap));
	// `cap.ceiling` is a `Ceiling`, a discriminated union over `measure` —
	// narrowed here rather than assumed, even though `client-exposure.ts`
	// only ever attaches a `percentage_share` ceiling to `concentrationCap`.
	const capRatio = $derived(
		cap && cap.ceiling.measure === 'percentage_share' ? cap.ceiling.value : null
	);
	const capSub = $derived(
		capRatio === null ? undefined : m.clients_share_cap_sub({ ratio: formatPercent(capRatio) })
	);

	type ContractRow = PageData['contracts'][number];

	// One rate-card figure per contract — its own currently active card,
	// resolved server-side (`resolveRateCard`, `+page.server.ts`) — the
	// same "amount / unit (disbursement)" string the contract detail
	// page's own rate-card table already prints (`rate-cards/rate-card-
	// enums.ts`'s `rateUnitLabel`/`disbursementPeriodLabel`), reused
	// rather than reinvented for a second column that would drift.
	function valueLabel(contractRow: ContractRow): string {
		const card = contractRow.activeRateCard;
		if (!card) return m.contract_no_active_rate_card();
		const perUnit = `${formatAmount(card.amount, contractRow.currency)} / ${rateUnitLabel(card.unit)}`;
		return card.disbursementPeriod
			? `${perUnit} (${disbursementPeriodLabel(card.disbursementPeriod)})`
			: perUnit;
	}

	// The "view" column the old hand-rolled table carried is gone: the title
	// is the link now, the same convention `/clients` itself already set.
	const contractColumns: readonly RecordColumn<ContractRow>[] = $derived([
		{ key: 'title', label: m.contract_form_title_label() },
		{
			key: 'status',
			label: m.contract_form_status_label(),
			format: (contract: ContractRow) => statusLabel(contract.status)
		},
		{
			key: 'value',
			label: m.contract_column_value(),
			align: 'end',
			format: valueLabel
		},
		{
			key: 'startsOn',
			label: m.contract_form_starts_on_label(),
			format: (contract: ContractRow) => formatDate(contract.startsOn)
		},
		{
			key: 'renewalType',
			label: m.contract_form_renewal_type_label(),
			format: (contract: ContractRow) => renewalTypeLabel(contract.renewalType)
		}
	]);
</script>

<svelte:head
	><title>{m.client_detail_page_title({ name: data.client.legalName })}</title></svelte:head
>

<Page
	title={data.client.legalName}
	subtitle={factLine([
		data.client.taxId,
		data.client.noticeChannel ? noticeChannelLabel(data.client.noticeChannel) : null
	])}
	crumbs={data.crumbs}
>
	<!-- A client can legitimately be incomplete (migration 0056). This is
	     the same "not configured yet" shape `practice_profile` uses, and it
	     names the fields rather than leaving a reader to notice the blanks. -->
	{#if data.invoicingGaps.length > 0}
		<Banner tone="warning">
			{m.client_detail_incomplete({
				fields: data.invoicingGaps.map((field) => clientFieldLabel(field)).join(', ')
			})}
			<a href={appHref(`/clients/${data.client.id}/edit`)}>{m.client_detail_incomplete_link()}</a>
		</Banner>
	{/if}
	{#snippet actions()}
		<a href={resolve('/clients/[id]/edit', { id: data.client.id })} class="underline"
			>{m.clients_edit_link()}</a
		>
	{/snippet}

	<!--
		Leads the page now (#242): the same figures the client list shows,
		for this one client, before identity or contracts — "who owes me"
		is why this record was opened, not its address.
	-->
	<Section title={m.client_financial_summary_heading()}>
		{#if !data.hasContract}
			<EmptyState
				icon="€"
				title={m.client_financial_summary_empty_title()}
				body={m.client_financial_summary_empty_body()}
			>
				{#snippet actions()}
					<a href={resolve('/clients/[id]/contracts/new', { id: data.client.id })} class="underline"
						>{m.contract_new_link()}</a
					>
				{/snippet}
			</EmptyState>
		{:else}
			<div class="stats-grid">
				<StatTile
					label={m.clients_column_outstanding()}
					value={formatMinorUnits(data.exposure.outstanding, CURRENCY)}
				/>
				<StatTile
					label={m.clients_column_collected()}
					value={formatMinorUnits(data.exposure.collectedThisYear, CURRENCY)}
				/>
				<StatTile label={m.clients_column_days()} value={formatDays(data.exposure.daysThisYear)} />
				<div class="share-tile">
					<StatTile
						label={m.clients_column_share()}
						value={formatPercent(data.exposure.revenueShareThisYear)}
						sub={capSub}
					/>
					{#if capBadge}
						<Badge variant={capBadge.variant} label={capBadge.label} size="sm" />
					{/if}
				</div>
			</div>
			<p class="basis-note">{m.clients_exposure_basis_note()}</p>
		{/if}
	</Section>

	<Section title={m.client_form_legal_identity_legend()}>
		<dl class="pairs">
			<dt>{m.client_form_tax_id_label()}</dt>
			<dd>{data.client.taxId}</dd>
			{#if data.client.vatId}
				<dt>{m.client_form_vat_id_label()}</dt>
				<dd>{data.client.vatId}</dd>
			{/if}
			<dt>{m.client_form_country_label()}</dt>
			<dd>{data.client.country}</dd>
			<dt>{m.clients_column_notice_channel()}</dt>
			<dd>
				{data.client.noticeChannel
					? noticeChannelLabel(data.client.noticeChannel)
					: m.client_detail_not_set()}
			</dd>
			<dt>{m.client_form_address_legend()}</dt>
			<dd>
				{data.client.addressLine1}{#if data.client.addressLine2}, {data.client.addressLine2}{/if},
				{data.client.addressCity}
				{data.client.addressPostalCode}
			</dd>
		</dl>
	</Section>

	{#if data.client.contacts.length > 0}
		<Section title={m.client_form_contacts_legend()}>
			<ul class="flex flex-col gap-1 text-sm">
				{#each data.client.contacts as contact (contact.id)}
					<li>
						{contact.name} — {contact.email}
						{#if contact.canApprove}<span class="opacity-70">{m.clients_can_approve_suffix()}</span
							>{/if}
					</li>
				{/each}
			</ul>
		</Section>
	{/if}

	<Section title={m.contract_section_heading()}>
		{#snippet actions()}
			<a href={resolve('/clients/[id]/contracts/new', { id: data.client.id })} class="underline"
				>{m.contract_new_link()}</a
			>
		{/snippet}

		{#if data.contracts.length === 0}
			<EmptyState icon="▤" title={m.contract_detail_empty_title()} body={m.contract_empty()} />
		{:else}
			<RecordList
				columns={contractColumns}
				rows={data.contracts}
				caption={m.contract_section_heading()}
				rowKey={(contract) => contract.id}
				rowHref={(contract) =>
					resolve('/clients/[id]/contracts/[contractId]', {
						id: data.client.id,
						contractId: contract.id
					})}
			/>
		{/if}
	</Section>
</Page>

<style>
	.stats-grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: var(--space-4);
	}
	@media (max-width: 639px) {
		.stats-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	.share-tile {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-2);
	}
	.basis-note {
		margin: var(--space-4) 0 0;
		font-size: var(--text-sm);
		color: var(--text-secondary);
		max-width: 60ch;
	}
	.pairs {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: var(--space-2) var(--space-4);
		font-size: var(--text-sm);
	}
	.pairs dt {
		color: var(--text-secondary);
	}
	.pairs dd {
		margin: 0;
		min-width: 0;
		overflow-wrap: anywhere;
		color: var(--text-primary);
	}
	@media (max-width: 639px) {
		.pairs {
			grid-template-columns: 1fr;
		}
		.pairs dt {
			margin-top: var(--space-2);
		}
	}
</style>
