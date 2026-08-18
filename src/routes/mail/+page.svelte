<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import { getLocale } from '$lib/paraglide/runtime';
	import Page from '$lib/layout/Page.svelte';
	import Section from '$lib/layout/Section.svelte';
	import { Badge, EmptyState } from '$lib/design';
	import Table from '$lib/design/Table.svelte';
	import type { TableColumn } from '$lib/design/table';
	import { mailPollBadge, mailPollMeta } from './poll-status';
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

	const locale = $derived(getLocale());
	const pollBadge = $derived(mailPollBadge(data.mailPoll.configured, data.mailPoll.health));
	const pollMeta = $derived(mailPollMeta(data.mailPoll.configured, data.mailPoll.health, locale));
</script>

<svelte:head><title>{m.mail_index_page_title()}</title></svelte:head>

{#snippet empty()}
	<EmptyState icon="✉" title={m.mail_index_heading()} body={m.mail_index_empty()} />
{/snippet}

<Page title={m.mail_index_heading()}>
	<Section title={m.mail_poll_status_heading()}>
		<div class="poll-status">
			<Badge variant={pollBadge.variant} label={pollBadge.label} size="sm" />
			<p>{pollMeta}</p>
		</div>
	</Section>

	<Table
		{columns}
		rows={data.contracts}
		caption={m.mail_index_heading()}
		rowKey={(row) => row.id}
		rowHref={(row) => resolve('/mail/contracts/[id]', { id: row.id })}
		{empty}
	/>
</Page>

<style>
	.poll-status {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-3);
	}
	.poll-status p {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}
</style>
