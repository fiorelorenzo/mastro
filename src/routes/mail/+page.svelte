<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import Page from '$lib/layout/Page.svelte';
	import { EmptyState } from '$lib/design';
	import Table from '$lib/design/Table.svelte';
	import type { TableColumn } from '$lib/design/table';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type Row = PageData['contracts'][number];

	const columns: readonly TableColumn<Row>[] = [
		{ key: 'title', label: m.mail_index_column_contract() },
		{
			key: 'client',
			label: m.mail_index_column_client(),
			format: (row) => row.client.legalName
		}
	];
</script>

<svelte:head><title>{m.mail_index_page_title()}</title></svelte:head>

{#snippet empty()}
	<EmptyState icon="✉" title={m.mail_index_heading()} body={m.mail_index_empty()} />
{/snippet}

<Page title={m.mail_index_heading()}>
	<Table
		{columns}
		rows={data.contracts}
		caption={m.mail_index_heading()}
		rowKey={(row) => row.id}
		rowHref={(row) => resolve('/mail/contracts/[id]', { id: row.id })}
		{empty}
	/>
</Page>
