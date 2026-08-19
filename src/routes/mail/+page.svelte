<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import { getLocale } from '$lib/paraglide/runtime';
	import Page from '$lib/layout/Page.svelte';
	import Section from '$lib/layout/Section.svelte';
	import { Badge, Button, EmptyState, toasts } from '$lib/design';
	import { submitting } from '$lib/design/submitting.svelte';
	import Table from '$lib/design/Table.svelte';
	import type { TableColumn } from '$lib/design/table';
	import { mailPollBadge, mailPollMeta } from './poll-status';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

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

	// #343: the button next to the status strip disables itself while its
	// own submit is in flight (a courtesy — the concurrency guarantee
	// itself lives server-side, `poll-lock.ts`'s own comment says why) and
	// is disabled outright whenever `data.mailPoll.configured` is false —
	// the same fact the badge/meta above already render, so a not-configured
	// instance never gets a button that fails on press.
	const pollNow = submitting();

	// Full-page navigation (no `use:enhance`, matching the rest of this
	// app), so `form` is fresh SSR output from the submit that produced it
	// and `data.mailPoll` above is already the post-poll state — the toast
	// is the only thing this effect has to do. `announcedPollNow` guards it
	// defensively against Svelte re-running the effect within one mount,
	// the same shape `proposals/[id]/+page.svelte` uses for its own
	// decision toast.
	let announcedPollNow = false;
	$effect(() => {
		const outcome = form?.pollNow;
		if (!outcome || announcedPollNow) return;
		announcedPollNow = true;
		if (!outcome.ok) {
			toasts.push(
				'danger',
				outcome.reason === 'in_flight'
					? m.mail_poll_now_in_flight_toast()
					: m.mail_poll_now_not_configured_toast()
			);
		} else if (outcome.status === 'skipped') {
			toasts.push('neutral', m.mail_poll_now_skipped_toast());
		} else if (outcome.status === 'failure') {
			toasts.push('danger', m.mail_poll_now_failure_toast({ detail: outcome.detail ?? '' }));
		} else {
			toasts.push(
				'success',
				m.mail_poll_now_success_toast({ archived: outcome.archived, skipped: outcome.skipped })
			);
		}
	});
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
			<form method="POST" action="?/pollNow" onsubmit={pollNow.onsubmit}>
				<Button
					type="submit"
					variant="secondary"
					size="sm"
					loading={pollNow.busy}
					disabled={!data.mailPoll.configured}
					title={!data.mailPoll.configured ? m.mail_poll_status_not_configured_meta() : undefined}
				>
					{m.mail_poll_now_button()}
				</Button>
			</form>
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
