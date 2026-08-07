<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import { formatDate } from '$lib/i18n/format';
	import { factLine } from '$lib/nav/crumbs';
	import Page from '$lib/layout/Page.svelte';
	import Section from '$lib/layout/Section.svelte';
	import RecordList from '$lib/layout/RecordList.svelte';
	import type { RecordColumn } from '$lib/layout/types';
	import { noticeChannelLabel } from '../notice-channel';
	import { renewalTypeLabel, statusLabel } from './contracts/contract-enums';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type ContractRow = PageData['contracts'][number];

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
	subtitle={factLine([data.client.taxId, noticeChannelLabel(data.client.noticeChannel)])}
	crumbs={data.crumbs}
>
	{#snippet actions()}
		<a href={resolve('/clients/[id]/edit', { id: data.client.id })} class="underline"
			>{m.clients_edit_link()}</a
		>
	{/snippet}

	<Section title={m.client_form_legal_identity_legend()}>
		<dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
			<dt class="opacity-70">{m.client_form_tax_id_label()}</dt>
			<dd>{data.client.taxId}</dd>
			{#if data.client.vatId}
				<dt class="opacity-70">{m.client_form_vat_id_label()}</dt>
				<dd>{data.client.vatId}</dd>
			{/if}
			<dt class="opacity-70">{m.client_form_country_label()}</dt>
			<dd>{data.client.country}</dd>
			<dt class="opacity-70">{m.clients_column_notice_channel()}</dt>
			<dd>{noticeChannelLabel(data.client.noticeChannel)}</dd>
			<dt class="opacity-70">{m.client_form_address_legend()}</dt>
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
			<p class="text-sm opacity-70">{m.contract_empty()}</p>
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
