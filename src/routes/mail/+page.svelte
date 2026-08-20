<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import { getLocale } from '$lib/paraglide/runtime';
	import Page from '$lib/layout/Page.svelte';
	import Section from '$lib/layout/Section.svelte';
	import { Badge, Banner, Button, EmptyState, toasts } from '$lib/design';
	import { submitting } from '$lib/design/submitting.svelte';
	import Table from '$lib/design/Table.svelte';
	import type { TableColumn } from '$lib/design/table';
	import { formatDateTime, formatNumber } from '$lib/i18n/format';
	import { mailPollBadge, mailPollMeta } from './poll-status';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type Row = PageData['contracts'][number];
	type UnknownSenderRow = PageData['unknownSenders'][number];

	// #394 removed the folder column this table used to earn its keep with
	// (#357): attribution is by sender address now, never by which folder a
	// message landed in, so there is nothing left on a contract for this
	// page to show per row. The table stays anyway - every row still links
	// to that contract's own mail templates, which nothing else on this
	// page does - just without a column that no longer names a fact.
	const columns: readonly TableColumn<Row>[] = [
		{ key: 'title', label: m.mail_index_column_contract() },
		{
			key: 'client',
			label: m.mail_index_column_client(),
			format: (row) => row.client.legalName
		}
	];

	// The panel this change is actually for (#394): every address that
	// wrote to the watched mailbox and matched no `client_contact`, so a
	// human can see what used to be invisible. On the live instance this is
	// what would have shown `leo@visumlabs.com` sitting next to a contact
	// recorded as `leonardo@visumlabs.com`, instead of 407 archived
	// messages nothing pointed at.
	const unknownSenderColumns: readonly TableColumn<UnknownSenderRow>[] = [
		{
			key: 'address',
			label: m.mail_unknown_senders_column_address(),
			cell: addressCell
		},
		{
			key: 'messages',
			label: m.mail_unknown_senders_column_messages(),
			align: 'end',
			format: (row) => formatNumber(row.messageCount)
		},
		{
			key: 'last',
			label: m.mail_unknown_senders_column_last(),
			format: (row) => formatDateTime(row.lastReceivedAt)
		},
		{
			key: 'subject',
			label: m.mail_unknown_senders_column_subject(),
			format: (row) => row.lastSubject ?? ''
		},
		{
			key: 'addContact',
			label: m.mail_unknown_senders_add_contact(),
			cell: addContactCell
		}
	];

	const locale = $derived(getLocale());
	const pollBadge = $derived(mailPollBadge(data.mailPoll.accountConfigured, data.mailPoll.health));
	const pollMeta = $derived(
		mailPollMeta(data.mailPoll.accountConfigured, data.mailPoll.health, locale)
	);

	// #343: the button next to the status strip disables itself while its
	// own submit is in flight (a courtesy — the concurrency guarantee itself
	// lives server-side, `poll-lock.ts`'s own comment says why) and is
	// disabled outright only when there is no mail account at all, which is
	// the one state where a poll cannot even be attempted. #394 removed the
	// "configured but nothing mapped" state this button used to also cover
	// (#351): an account with credentials always has a mailbox to watch now,
	// so `accountConfigured` is the only gate left.
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
			// #380: name the outcomes apart. "40 archived from senders nobody
			// knows" is what a normal inbox looks like, and reading it as 40
			// failures would be wrong. #388: a pass that also recovered older
			// messages - because a contact was added since the last poll -
			// leads with that, since it is the answer to "did adding the
			// contact work" and the reader should not have to notice the
			// unknown-senders panel below shrank on its own.
			toasts.push(
				'success',
				outcome.recovered > 0
					? m.mail_poll_now_success_toast_with_recovered({
							archived: outcome.archived,
							unknown: outcome.unknownSender,
							recovered: outcome.recovered
						})
					: outcome.unknownSender > 0
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

{#snippet unknownSendersEmpty()}
	<EmptyState
		icon="✔"
		title={m.mail_unknown_senders_empty_title()}
		body={m.mail_unknown_senders_empty_body()}
	/>
{/snippet}

<!--
	#394: the badge is why this row is where it is. Ordering used to be by
	recency, which on a real mailbox buried the one address that mattered at
	position 57 of 133 behind every newsletter that happened to arrive that
	morning. An address at a domain some contact of yours already uses is
	almost never a newsletter, so it sorts first and says so.
-->
{#snippet addressCell(row: UnknownSenderRow)}
	<span class="address">
		{row.senderAddress ?? m.mail_unknown_senders_unreadable()}
		{#if row.domainKnown}
			<Badge variant="info" size="sm" label={m.mail_unknown_senders_domain_known_badge()} />
		{/if}
	</span>
{/snippet}

<!-- The link is the same target for every row (#394): there is no "add
     contact to which client" screen that takes an address, so this points
     at the client list rather than inventing one. Read-only per row - a
     plain link, not a form control - so this stays fine inside `Table`
     (see `Table.svelte`'s own header comment on why a form control in a
     cell would be a different story). -->
{#snippet addContactCell()}
	<a href={resolve('/clients')} class="underline">{m.mail_unknown_senders_add_contact()}</a>
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
		{#if data.unknownSenderArchivedCount > 0}
			<!-- #385: on the live instance 390 messages were archived and none
			     was ever going to be extracted, and nothing on this screen said
			     why. The toast a manual poll drives below
			     (`mail_poll_now_success_toast_with_unknown`) names the count for
			     the one pass that just ran and is gone on the next navigation;
			     this reads the standing count off `inbound_thread` itself
			     (`+page.server.ts`), so the explanation is here on every load,
			     not only right after pressing the button. #394: the promise
			     this banner makes - that a message already archived becomes
			     readable once its sender is added as a contact - is now
			     actually true, `reattributeKnownSenders` runs at the start of
			     every poll (#388), where it used to require the extra
			     `mailFolder` field this instance never set. -->
			<Banner tone="warning">
				{m.mail_unknown_sender_explainer()}
				{#snippet actions()}
					<a href={resolve('/clients')} class="underline">{m.contracts_empty_action()}</a>
				{/snippet}
			</Banner>
		{/if}
	</Section>

	<Section title={m.mail_unknown_senders_heading()}>
		<p class="hint">{m.mail_unknown_senders_hint()}</p>
		<Table
			columns={unknownSenderColumns}
			rows={data.unknownSenders}
			caption={m.mail_unknown_senders_heading()}
			rowKey={(row) => row.senderAddress ?? 'unreadable'}
			empty={unknownSendersEmpty}
		/>
	</Section>

	<!--
		#394: this table used to be the folder-mapping screen, which is what
		named it. With the folder gone its remaining reason to exist is the
		outbound side - each row leads to that contract's templates, day
		register and sent history - so it says so rather than sitting under
		the page title as a nameless list of contracts.
	-->
	<Section title={m.mail_index_contracts_heading()}>
		<p class="hint">{m.mail_index_contracts_hint()}</p>
		<Table
			{columns}
			rows={data.contracts}
			caption={m.mail_index_contracts_heading()}
			rowKey={(row) => row.id}
			rowHref={(row) => resolve('/mail/contracts/[id]', { id: row.id })}
			{empty}
		/>
	</Section>
</Page>

<style>
	.address {
		display: inline-flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
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
	.hint {
		margin: 0 0 var(--space-3);
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}
</style>
