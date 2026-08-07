<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import { formatNumber } from '$lib/i18n/format';
	import Page from '$lib/layout/Page.svelte';
	import RecordList from '$lib/layout/RecordList.svelte';
	import type { RecordColumn } from '$lib/layout/types';
	import { noticeChannelLabel } from './notice-channel';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type Row = PageData['clients'][number];

	// One column list, two renderings. The edit link that used to be a sixth
	// column is gone: the name leads to the client, and editing is a link on
	// that page, which is one less column to fit on a phone.
	const columns: readonly RecordColumn<Row>[] = $derived([
		{ key: 'legalName', label: m.clients_column_legal_name() },
		{ key: 'taxId', label: m.clients_column_tax_id() },
		{ key: 'country', label: m.clients_column_country() },
		{
			key: 'noticeChannel',
			label: m.clients_column_notice_channel(),
			format: (client: Row) => noticeChannelLabel(client.noticeChannel)
		},
		{
			key: 'contacts',
			label: m.clients_column_contacts(),
			align: 'end',
			format: (client: Row) =>
				client.contacts.some((contact) => contact.canApprove)
					? `${formatNumber(client.contacts.length)} ${m.clients_can_approve_suffix()}`
					: formatNumber(client.contacts.length)
		}
	]);
</script>

<svelte:head><title>{m.clients_page_title()}</title></svelte:head>

<Page title={m.clients_heading()}>
	{#snippet actions()}
		<a href={resolve('/clients/new')} class="underline">{m.clients_new_link()}</a>
	{/snippet}

	{#if data.clients.length === 0}
		<p class="text-sm opacity-70">{m.clients_empty()}</p>
	{:else}
		<RecordList
			{columns}
			rows={data.clients}
			caption={m.clients_heading()}
			rowKey={(client) => client.id}
			rowHref={(client) => `/clients/${client.id}`}
		/>
	{/if}
</Page>
