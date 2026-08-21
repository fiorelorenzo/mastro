<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import { getLocale } from '$lib/paraglide/runtime';
	import Page from '$lib/layout/Page.svelte';
	import Section from '$lib/layout/Section.svelte';
	import { Badge, Banner, Button, EmptyState, toasts } from '$lib/design';
	import Table from '$lib/design/Table.svelte';
	import type { TableColumn } from '$lib/design/table';
	import { formatDateTime, formatNumber } from '$lib/i18n/format';
	import type { PollProgress } from '$lib/mail/poll-phase';
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
	// Not `submitting()`, and its own doc comment says why: that helper never
	// lowers the flag, because everywhere else a submit navigates and the
	// re-mount resets it. This form is enhanced (see the note further down),
	// so the component outlives its own submit and something has to lower it.
	let polling = $state(false);

	// The phases of the poll in flight, read from `poll-progress/+server.ts`
	// while the submit above is open (#405). Polled rather than streamed: the
	// whole log is four to six short rows and refetching all of it is cheaper
	// than holding an SSE connection open for the seconds it lives, which is
	// the trade the extraction registry makes the other way round because a
	// run there can last minutes and nobody is watching a button.
	const PROGRESS_INTERVAL_MS = 700;
	let progress = $state<PollProgress | null>(null);
	let progressTimer: ReturnType<typeof setInterval> | null = null;

	async function readProgress() {
		try {
			const response = await fetch(resolve('/mail/poll-progress'), { cache: 'no-store' });
			if (response.ok) progress = (await response.json()) as PollProgress;
		} catch {
			// A failed progress read says nothing about the poll itself, which
			// is running server-side either way. Leaving the last phases on
			// screen is a better answer than replacing them with an error
			// about a request nobody asked for.
		}
	}

	function watchProgress() {
		progress = null;
		void readProgress();
		progressTimer = setInterval(() => void readProgress(), PROGRESS_INTERVAL_MS);
	}

	function stopWatchingProgress() {
		if (progressTimer !== null) clearInterval(progressTimer);
		progressTimer = null;
		// One last read, because the terminal phase is written between the
		// previous tick and the response arriving: without this the log ends
		// on `fetching` and reads as unfinished for as long as it stays up.
		void readProgress();
	}

	// A tab closed or navigated away mid-poll must not leave a timer behind.
	$effect(() => () => {
		if (progressTimer !== null) clearInterval(progressTimer);
	});

	/** The phase list, as sentences. Structured server-side on purpose
	 * (`poll-progress.ts`): the server reports a phase and a count, and the
	 * words are chosen here, in the reader's own language (#286). */
	const progressLines = $derived(
		(progress?.steps ?? []).map((step) => {
			switch (step.phase) {
				case 'connecting':
					// The first attempt is just "connecting"; the retries are the
					// ones worth numbering, because that is when a reader starts
					// wondering whether anything is happening at all.
					return (step.count ?? 1) > 1
						? m.mail_poll_progress_connecting_retry({
								attempt: step.count ?? 1,
								of: step.of ?? 1
							})
						: m.mail_poll_progress_connecting();
				case 'reattributing':
					return m.mail_poll_progress_reattributing({ count: step.count ?? 0 });
				case 'mailbox_opened':
					return m.mail_poll_progress_mailbox_opened({ count: step.count ?? 0 });
				case 'listing':
					return m.mail_poll_progress_listing({ count: step.count ?? 0, of: step.of ?? 0 });
				case 'fetching':
					return m.mail_poll_progress_fetching({ count: step.count ?? 0 });
				case 'archived':
					return m.mail_poll_progress_archived({ count: step.count ?? 0 });
				case 'done':
					return m.mail_poll_progress_done({ count: step.count ?? 0 });
				case 'failed':
					return m.mail_poll_progress_failed();
			}
		})
	);

	// The poll is submitted with `use:enhance` (#405), which is the exception
	// this app makes to the rule stated in `submitting.svelte.ts`: everything
	// else navigates on submit, because a re-mount with the server's values
	// is what makes several forms' `$state` initialisers correct. Nothing on
	// this page initialises `$state` from a prop, and a mailbox poll is the
	// one submit here that routinely takes tens of seconds — long enough that
	// replacing the whole page with a spinner, button included, is the wrong
	// answer. The progress log below is what fills that time instead.
	//
	// So the component stays mounted across a submit, and the announcement
	// below can no longer assume it runs once per mount. It compares the
	// outcome by reference: every submit deserialises a fresh object, so the
	// second poll of one mount announces, and a re-render with the same
	// object does not. That also keeps the un-enhanced path (no JS, a real
	// navigation) announcing exactly as it did before.
	let announced: unknown = null;
	$effect(() => {
		const outcome = form?.pollNow;
		if (!outcome || outcome === announced) return;
		announced = outcome;
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
			<form
				method="POST"
				action="?/pollNow"
				use:enhance={() => {
					polling = true;
					watchProgress();
					return async ({ update }) => {
						stopWatchingProgress();
						polling = false;
						// The default `update()` behaviour, spelled out: apply the
						// action result (which the announcement effect above reads)
						// and invalidate, so the status badge, the contract table and
						// the unknown-senders panel all show the post-poll state
						// without the page having navigated. `reset: false` because
						// there is nothing in this form to reset.
						await update({ reset: false, invalidateAll: true });
					};
				}}
			>
				<Button
					type="submit"
					variant="secondary"
					size="sm"
					loading={polling}
					disabled={!data.mailPoll.accountConfigured}
					title={!data.mailPoll.accountConfigured
						? m.mail_poll_status_not_configured_meta()
						: undefined}
				>
					{m.mail_poll_now_button()}
				</Button>
			</form>
		</div>
		{#if polling || progressLines.length > 0}
			<!-- #405: what fills the tens of seconds a real mailbox takes. It
			     stays on screen after the poll ends, because the last thing a
			     reader saw should not vanish at the moment it becomes the
			     answer. -->
			<ol class="poll-log" aria-live="polite">
				{#each progressLines as line, index (index)}
					<li>{line}</li>
				{/each}
				{#if polling}
					<li class="poll-log-waiting">{m.mail_poll_progress_working()}</li>
				{/if}
			</ol>
		{/if}
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
			<div class="explainer">
				<Banner tone="warning">
					{m.mail_unknown_sender_explainer()}
					{#snippet actions()}
						<a href={resolve('/clients')} class="underline">{m.contracts_empty_action()}</a>
					{/snippet}
				</Banner>
			</div>
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
	/* A log, not body copy (#405). It sits directly under the status row it
	   belongs to, so it is indented against that row's own left edge and set
	   in the same secondary colour as the status sentence: what a reader
	   wants from it is the last line, and the ones above it only matter as
	   the reason that line makes sense. Numerals are tabular so the counts
	   line up as they arrive rather than dancing left and right. */
	.poll-log {
		margin: var(--space-3) 0 0;
		padding: 0 0 0 var(--space-3);
		border-left: 1px solid var(--border-hairline);
		list-style: none;
		display: grid;
		gap: 2px;
		font-size: var(--text-sm);
		font-variant-numeric: tabular-nums;
		color: var(--text-secondary);
	}
	/* The phase still running, which is the only row whose text is not yet
	   an outcome. Dimmer than the settled ones on purpose: it is the one
	   line that will be replaced rather than added to. */
	.poll-log-waiting {
		color: var(--text-muted);
		font-style: italic;
	}
	/* The Banner has no margins of its own, deliberately: one placed first
	   inside a Section should not be pushed off its heading. Here it follows
	   the poll-status row, so it was sitting flush against it - measured at
	   0px above against 32px below, which is the asymmetry that reads as
	   wrong rather than tight. */
	.explainer {
		margin-top: var(--space-4);
	}
	.hint {
		margin: 0 0 var(--space-3);
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}
</style>
