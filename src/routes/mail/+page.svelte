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

	// The folder column (#357). This page listed the contract and the
	// client and not the one fact it exists for: whether that contract has
	// an inbound folder, and which. The status strip above says "no folder
	// mapped" correctly, and the table below could not be reconciled with
	// it - on a screen listing every contract there was no way to tell
	// which of them was the reason, and every row already links to the
	// screen that fixes it.
	//
	// Unmapped is a badge, not a blank cell: a blank reads as a rendering
	// gap, and this is a decision nobody has taken yet. Every contract born
	// from an accepted proposal starts here, since no extraction can invent
	// which folder a human will file a client's mail under.
	const columns: readonly TableColumn<Row>[] = [
		{ key: 'title', label: m.mail_index_column_contract() },
		{
			key: 'client',
			label: m.mail_index_column_client(),
			format: (row) => row.client.legalName
		},
		{ key: 'folder', label: m.mail_index_column_folder(), cell: folderCell }
	];

	const locale = $derived(getLocale());
	const pollBadge = $derived(
		mailPollBadge(
			data.mailPoll.accountConfigured,
			data.mailPoll.anyFolderMapped,
			data.mailPoll.health
		)
	);
	const pollMeta = $derived(
		mailPollMeta(
			data.mailPoll.accountConfigured,
			data.mailPoll.anyFolderMapped,
			data.mailPoll.health,
			locale
		)
	);

	// #343: the button next to the status strip disables itself while its
	// own submit is in flight (a courtesy — the concurrency guarantee itself
	// lives server-side, `poll-lock.ts`'s own comment says why) and is
	// disabled outright only when there is no mail account at all, which is
	// the one state where a poll cannot even be attempted.
	//
	// It stays pressable with an account configured and nothing mapped
	// (#351). A poll then answers "skipped, no folders configured", which is
	// the truth and more useful than a disabled control: the previous
	// version disabled it in that state and its tooltip claimed IMAP was
	// unconfigured, on an instance where IMAP was configured and working.
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
		} else if (outcome.status === 'failure') {
			toasts.push('danger', m.mail_poll_now_failure_toast({ detail: outcome.detail ?? '' }));
		} else {
			// #380: name the three outcomes apart. "40 archived from senders
			// nobody knows" is what a normal inbox looks like, and reading it
			// as 40 failures would be wrong.
			toasts.push(
				'success',
				outcome.unknownSender > 0
					? m.mail_poll_now_success_toast_with_unknown({
							archived: outcome.archived,
							unknown: outcome.unknownSender,
							skipped: outcome.skipped
						})
					: m.mail_poll_now_success_toast({
							archived: outcome.archived,
							skipped: outcome.skipped
						})
			);
		}
	});
</script>

<svelte:head><title>{m.mail_index_page_title()}</title></svelte:head>

{#snippet empty()}
	<EmptyState icon="✉" title={m.mail_index_heading()} body={m.mail_index_empty()} />
{/snippet}

{#snippet folderCell(row: Row)}
	{#if row.mailFolder}
		<code class="folder">{row.mailFolder}</code>
	{:else}
		<Badge variant="warning" label={m.mail_index_folder_unset_badge()} size="sm" />
	{/if}
{/snippet}

<!-- `wide`, matching every other index that carries a table (#373). -->
<Page title={m.mail_index_heading()} width="wide">
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
					disabled={!data.mailPoll.accountConfigured}
					title={!data.mailPoll.accountConfigured
						? m.mail_poll_status_not_configured_meta()
						: undefined}
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
	/* The folder is a literal IMAP path the reader may have to compare
	   character by character with their mail client's own tree, so it is
	   set in the mono face rather than the prose face. */
	.folder {
		font-family: var(--font-mono);
		font-size: var(--text-sm);
	}
</style>
