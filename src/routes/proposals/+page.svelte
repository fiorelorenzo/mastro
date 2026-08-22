<!--
	The review queue (#243): pending proposals grouped by the archived
	message that produced them — two days from one "ok for Thursday and
	Friday" email read as siblings, each with its own accept/reject, plus
	one accept-all for the message. Decided history (`?status=accepted` /
	`?status=rejected`) is a flatter list, one row each, nothing left to
	group by message once the decision is made.
-->
<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import { formatAmount, formatDate, formatDateTime, formatNumber } from '$lib/i18n/format';
	import { factLine } from '$lib/nav/crumbs';
	import { Amount, Badge, Banner, Button, EmptyState, Tabs } from '$lib/design';
	import Page from '$lib/layout/Page.svelte';
	import ProposalStatusBadge from './ProposalStatusBadge.svelte';
	import { proposalConfidenceBadge, proposalQuantityLabel } from './proposal-status';
	import { viewResultLabel } from './decision-wording';
	import { proposalIssueMessage } from '$lib/i18n/proposal-issue';
	import { submitting } from '$lib/design/submitting.svelte';
	import { rereadBlockReasonMessage, rereadEligibility } from '$lib/extraction/reread-eligibility';
	import { paymentTermsKindLabel } from '../clients/[id=uuid]/contracts/contract-enums';
	import { rateUnitLabel } from '../clients/[id=uuid]/contracts/[contractId=uuid]/rate-cards/rate-card-enums';
	import type { ProposedContract } from './queue-fields';
	import type { HistoryRow, QueueGroup, QueueRow } from './+page.server';
	import type { ActionData, PageProps } from './$types';

	let { data, form }: PageProps & { form: ActionData } = $props();

	const tabs = $derived([
		{
			href: `${resolve('/proposals')}?status=pending`,
			label: m.proposal_list_tab_pending(),
			selected: data.status === 'pending',
			badge:
				data.pendingCount !== null
					? { variant: 'info' as const, count: data.pendingCount }
					: undefined
		},
		{
			href: `${resolve('/proposals')}?status=accepted`,
			label: m.proposal_list_tab_accepted(),
			selected: data.status === 'accepted'
		},
		{
			href: `${resolve('/proposals')}?status=rejected`,
			label: m.proposal_list_tab_rejected(),
			selected: data.status === 'rejected'
		}
	]);

	/**
	 * A row says what it proposes, which depends on what kind of thing that
	 * is. Rendering every proposal as a day produced "— — —" on a contract
	 * proposal, because a contract has no date and no quantity to put on
	 * either side of the dash — two placeholders and a separator, and
	 * nothing else.
	 */
	function rowTitle(row: QueueRow | HistoryRow): string {
		if (row.targetType === 'contract') {
			return row.proposedContract
				? m.proposal_queue_row_contract({
						client: row.proposedContract.clientLegalName,
						title: row.proposedContract.contract.title
					})
				: m.proposal_queue_row_unreadable();
		}
		if (row.date === null && row.quantity === null) return m.proposal_queue_row_unreadable();
		const datePart = row.date ? formatDate(row.date) : '—';
		const quantityPart = row.quantity !== null ? proposalQuantityLabel(row.quantity) : '—';
		return `${datePart} — ${quantityPart}`;
	}

	/**
	 * Whose decision a card is: the counterparty, and which of their
	 * contracts it lands on. The old layout kept both in a grey line *under*
	 * the card, which for a first-intake contract read "Nuovo contratto" and
	 * nothing else.
	 *
	 * Two parts rather than one string, so the client reads first and the
	 * contract as context. They are separate elements because a contract
	 * people named after their client ("Consulenza operativa — Nordwind
	 * Logistics") otherwise stutters against it, and the alternative is
	 * guessing at when a title already contains a legal name — a string
	 * heuristic that would be wrong the first time somebody's company shares
	 * a word with their project.
	 */
	function cardHeading(group: QueueGroup): { client: string; contract: string | null } {
		const proposed = group.rows.find((row) => row.proposedContract)?.proposedContract;
		// A first-intake contract has no contract row yet: the proposal itself
		// names the counterparty, and its title is the row's own heading below.
		if (proposed) return { client: proposed.clientLegalName, contract: null };
		return {
			client: group.clientLegalName || group.contractTitle,
			contract: group.clientLegalName ? group.contractTitle : null
		};
	}

	/**
	 * The byline: where this came from and when. A message names its sender
	 * and its subject, an upload has neither and names its file instead,
	 * which is a reference rather than a title and is typeset like one.
	 *
	 * Both times go through `formatDateTime`, because both are instants: a
	 * message's `receivedAt` and a document's `createdAt` are points on the
	 * timeline, not calendar days. `formatDate` is the other one — it pins to
	 * UTC on purpose, and feeding it a full ISO timestamp throws
	 * `Invalid time value`, which is exactly what the first load of this card
	 * did.
	 */
	function sourceLine(group: QueueGroup): string {
		const when = group.sourceAt
			? group.fromMessage
				? formatDateTime(group.sourceAt)
				: m.proposal_queue_uploaded_on({ when: formatDateTime(group.sourceAt) })
			: null;
		return group.fromMessage
			? factLine([group.sender, group.subject, when])
			: factLine([group.documentName, when]);
	}

	/**
	 * The four terms a first-intake contract is judged on, in the vocabulary
	 * the contract detail page already uses for the same facts — same keys,
	 * same value shapes, so the card and the contract it becomes cannot read
	 * differently. The renewal notice is deliberately absent: when it is the
	 * unresolved one, the banner below already says so, and when it is not
	 * it is not what decides this.
	 */
	function contractTerms(proposed: ProposedContract): { dt: string; dd: string }[] {
		const c = proposed.contract;
		const [rate] = proposed.rateCards;
		// `paymentTerms` is one of the fields a real contract is allowed to
		// leave ambiguous, so the extraction may report it as null. An
		// unresolved term says so in the same words the review screen uses for
		// it, rather than being quietly omitted from a card whose whole job is
		// to show what the terms are.
		const payment =
			c.paymentTerms === null
				? m.proposal_contract_field_unresolved_placeholder()
				: c.paymentTerms.kind === 'net'
					? `${paymentTermsKindLabel('net')} (${formatNumber(c.paymentTerms.days)})`
					: `${paymentTermsKindLabel('day_of_month')} (${formatNumber(c.paymentTerms.day)})`;
		return [
			{
				dt: m.proposal_queue_terms_period(),
				dd: `${formatDate(c.startsOn)} – ${c.endsOn ? formatDate(c.endsOn) : m.contract_ends_on_open()}`
			},
			{
				dt: m.rate_card_column_amount(),
				dd: rate
					? `${formatAmount(rate.amount, c.currency)} / ${rateUnitLabel(rate.unit)}${
							proposed.rateCards.length > 1
								? ` · ${m.proposal_queue_rates_more({ count: proposed.rateCards.length - 1 })}`
								: ''
						}`
					: m.rate_card_empty()
			},
			{ dt: m.contract_form_payment_terms_kind_label(), dd: payment },
			{
				dt: m.contract_detail_terms_prior_approval_label(),
				dd: c.requiresPriorApproval
					? m.contract_detail_terms_prior_approval_required()
					: m.contract_form_requires_prior_approval_not_required_option()
			}
		];
	}

	/**
	 * Whether a decided-history row offers "read this conversation again"
	 * (#404) — a rejected work-unit row with a real conversation behind it.
	 * `null` for everything else (accepted rows, a contract proposal, a
	 * first-intake upload with no message), so the template's own `{#if}`
	 * both gates the button and narrows `row.hasInFlightRereadRun` to a row
	 * that actually has it.
	 */
	function rereadOffer(row: HistoryRow) {
		if (row.status !== 'rejected' || row.targetType !== 'work_unit' || !row.fromMessage) {
			return null;
		}
		return rereadEligibility({ hasInFlightRun: row.hasInFlightRereadRun });
	}
</script>

<svelte:head><title>{m.proposal_list_page_title()}</title></svelte:head>

<Page title={m.proposal_list_heading()} subtitle={m.proposal_list_subtitle()} width="wide">
	<Tabs label={m.proposal_list_heading()} {tabs} />

	{#if form?.actionError}
		<p class="action-error" role="alert">
			{form.actionError}
		</p>
	{/if}

	{#if data.status === 'pending'}
		{#if data.groups.length === 0}
			<EmptyState
				icon="✓"
				title={m.proposal_list_empty_pending_title()}
				body={m.proposal_list_empty_pending_body()}
			/>
		{:else}
			{#each data.groups as group (group.documentId)}
				{@const acceptAll = submitting()}
				{@const heading = cardHeading(group)}
				<!--
					A card per source document, not a page section. `Section` renders
					an `<h2>` — 18px/600 against this page's own 24px `<h1>` — so
					heading a group with it gave a PDF's file name, the least
					actionable fact on the screen, nearly the weight of the page
					title, while the decision itself sat in a 35px row. The source is
					a byline now: quiet, dated, with its own link, above the thing
					being decided.
				-->
				<article class="decision">
					<h3 class="who">
						{heading.client}
						{#if heading.contract}<span class="who-contract">{heading.contract}</span>{/if}
					</h3>
					<p class="source">
						<!-- Glyph and facts are one unit: left as siblings of the link in a
						     wrapping flex row, the glyph took a line of its own on a phone
						     and the byline became three lines. -->
						<span class="source-what">
							<span class="source-ico" aria-hidden="true">{group.fromMessage ? '✉' : '↑'}</span>
							<span class="source-facts">{sourceLine(group)}</span>
						</span>
						<a class="source-link" href={resolve('/proposals/[id=uuid]', { id: group.rows[0].id })}>
							{m.proposal_queue_review()}
						</a>
					</p>
					<!-- #409: a day confirmed by the client and a day resting on my own
					     reply are not the same claim, and an address alone does not say
					     which one a reviewer is looking at before the one-tap Accept below.
					     One badge per card, not per row: every row here shares one source
					     thread, and this is the same fact and the same strings the detail
					     screen's own evidence badge already uses. -->
					<p class="evidence-source">
						<Badge
							variant={group.mine ? 'warning' : 'info'}
							label={group.mine
								? m.proposal_evidence_source_mine_badge()
								: m.proposal_evidence_source_badge()}
							size="sm"
						/>
					</p>

					<ul class="proposals">
						{#each group.rows as row (row.id)}
							{@const confidence = proposalConfidenceBadge(row.confidence)}
							{@const accept = submitting()}
							{@const reject = submitting()}
							{@const only = group.rows.length === 1}
							<li class="proposal">
								<div class="what">
									<a class="what-title" href={resolve('/proposals/[id=uuid]', { id: row.id })}>
										{row.proposedContract ? row.proposedContract.contract.title : rowTitle(row)}
									</a>
									{#if row.amount !== null}
										<Amount major={row.amount} currency={group.currency} size="inline" />
									{/if}
								</div>

								<!-- What this proposal is, in its own terms. A contract has no
								     date and no quantity to describe it with, and its terms are
								     the decision, so they are on the card instead of one click
								     away behind Review. -->
								{#if row.proposedContract}
									<dl class="terms">
										{#each contractTerms(row.proposedContract) as term (term.dt)}
											<div class="term">
												<dt>{term.dt}</dt>
												<dd>{term.dd}</dd>
											</div>
										{/each}
									</dl>
								{:else if row.scope}
									<p class="scope">{row.scope}</p>
								{/if}

								<p class="excerpt">{row.excerpt}</p>
								{#if row.revised}
									<p class="revised">
										<Badge variant="info" label={m.proposal_queue_revised_badge()} size="sm" />
									</p>
								{/if}

								<p class="judgement">
									<Badge variant={confidence.variant} label={confidence.label} size="sm" />
									{#if row.confidenceReason}
										<span class="reason">{row.confidenceReason}</span>
									{/if}
								</p>

								<!-- The blocker sits with the button it blocks. It used to be a
								     red sentence in the metadata line, three lines of it on a
								     phone, while Accept was pale for reasons the screen never
								     stated: the reader had to infer the causal link. -->
								{#if row.validationIssue}
									<Banner tone="warning">{proposalIssueMessage(row.validationIssue)}</Banner>
								{/if}

								<div class="decide" class:decide--only={only}>
									<form method="POST" action="?/accept" onsubmit={accept.onsubmit}>
										<input type="hidden" name="id" value={row.id} />
										<Button
											type="submit"
											variant={only ? 'primary' : 'secondary'}
											size={only ? 'md' : 'sm'}
											disabled={row.validationIssue !== null}
											loading={accept.busy}
										>
											{only ? m.proposal_detail_accept_submit() : m.proposal_queue_accept_row()}
										</Button>
									</form>
									<form method="POST" action="?/reject" onsubmit={reject.onsubmit}>
										<input type="hidden" name="id" value={row.id} />
										<Button
											type="submit"
											variant="danger"
											size={only ? 'md' : 'sm'}
											loading={reject.busy}
										>
											{m.proposal_detail_reject_submit()}
										</Button>
									</form>
								</div>
							</li>
						{/each}
					</ul>

					<!-- One email approving three days is one decision in practice, so
					     it gets the card's only prominent button; the per-row ones stay
					     for the reviewer who is sure about Thursday and not about
					     Friday. A single-row card has no "all" to accept — its own row
					     carries the primary instead. -->
					{#if group.rows.length > 1}
						<div class="group-decide">
							<form method="POST" action="?/acceptAll" onsubmit={acceptAll.onsubmit}>
								<input type="hidden" name="documentId" value={group.documentId} />
								<Button
									type="submit"
									variant="primary"
									disabled={group.rows.some((row) => row.validationIssue !== null)}
									loading={acceptAll.busy}
								>
									{m.proposal_queue_accept_all({ count: group.rows.length })}
								</Button>
							</form>
						</div>
					{/if}
				</article>
			{/each}
		{/if}
	{:else if data.rows.length === 0}
		<EmptyState
			icon={data.status === 'accepted' ? '✓' : '○'}
			title={data.status === 'accepted'
				? m.proposal_list_empty_accepted_title()
				: m.proposal_list_empty_rejected_title()}
			body={data.status === 'accepted'
				? m.proposal_list_empty_accepted_body()
				: m.proposal_list_empty_rejected_body()}
		/>
	{:else}
		<ul class="rows history">
			{#each data.rows as row (row.id)}
				{@const when = row.sourceAt ? formatDateTime(row.sourceAt) : null}
				{@const reread = rereadOffer(row)}
				<li class="row">
					<span class="row-ico" aria-hidden="true">{row.status === 'accepted' ? '✓' : '✕'}</span>
					<div class="row-main">
						<a class="row-title" href={resolve('/proposals/[id=uuid]', { id: row.id })}>
							{rowTitle(row)}
						</a>
						<span class="row-meta">
							<ProposalStatusBadge status={row.status} />
							<!-- The note names the source it actually had. All three
							     sentences assumed a message, so a contract proposal read off
							     an uploaded PDF was described as "created from a message
							     from …" with an empty date, and its rejection promised that
							     "the message stays archived" — of a message that never
							     existed. -->
							{#if row.status === 'accepted'}
								{#if !row.fromMessage}
									{#if row.documentName}
										{m.proposal_history_created_note_document({
											name: row.documentName,
											when: when ?? ''
										})}
									{:else}
										{m.proposal_history_created_note_document_unnamed({ when: when ?? '' })}
									{/if}
								{:else if row.sender}
									{m.proposal_history_created_note({ sender: row.sender, when: when ?? '' })}
								{:else}
									{m.proposal_history_created_note_no_sender({ when: when ?? '' })}
								{/if}
								{#if row.amount !== null}
									·
									<Amount major={row.amount} currency={row.currency} size="inline" />
								{/if}
							{:else if row.fromMessage}
								{m.proposal_history_rejected_note({ when: when ?? '' })}
							{:else}
								{m.proposal_history_rejected_note_document({ when: when ?? '' })}
							{/if}
						</span>
						{#if reread && !reread.canReread && reread.reason}
							<span class="reread-note">{rereadBlockReasonMessage(reread.reason)}</span>
						{/if}
					</div>
					<div class="row-actions">
						{#if row.result}
							<!--
								The label and the destination come from one fact (#356).
								This block used to link `/day/[id]` for every accepted row
								and label it "View the day", so an accepted contract
								proposal offered one action and it answered 404 "Day not
								found" — measured, not supposed.
							-->
							<Button
								href={row.result.kind === 'contract'
									? resolve('/clients/[id=uuid]/contracts/[contractId=uuid]', {
											id: row.result.clientId,
											contractId: row.result.contractId
										})
									: row.result.kind === 'invoice'
										? resolve('/invoices/[id=uuid]', { id: row.result.id })
										: resolve('/day/[id=uuid]', { id: row.result.id })}
								variant="tertiary"
								size="sm"
							>
								{viewResultLabel(row.result.kind)}
							</Button>
						{/if}
						{#if reread?.canReread}
							{@const rereadSubmit = submitting()}
							<!-- #404: reachable here even for a document with zero
							     `extraction_run` rows — a rejected proposal keeps its
							     document permanently out of the automatic sweep
							     (`listInboundThreadsAwaitingExtraction`'s own
							     `isNull(proposal.id)`), so this is the surface for exactly
							     the case the registry cannot reach. -->
							<form method="POST" action="?/reread" onsubmit={rereadSubmit.onsubmit}>
								<input type="hidden" name="documentId" value={row.documentId} />
								<Button type="submit" variant="tertiary" size="sm" loading={rereadSubmit.busy}>
									{m.proposal_history_reread_button()}
								</Button>
							</form>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</Page>

<style>
	.action-error {
		margin: var(--space-4) 0 0;
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--color-danger);
		border-radius: var(--radius-md);
		color: var(--color-danger);
		font-size: var(--text-sm);
	}

	/* One card per source document: a decision, not a row. The hairline and
	   the page surface, nothing else — the same restraint `Card` holds. */
	.decision {
		margin-top: var(--space-5);
		border: 1px solid var(--border-hairline);
		border-radius: var(--radius-md);
		padding: var(--space-4);
	}
	.who {
		margin: 0;
		font-size: var(--text-md);
		font-weight: var(--weight-medium);
		color: var(--text-primary);
	}
	/* Which contract, as context rather than a second title. The separator is
	   CSS so the two facts stay separate elements: joining them into one
	   string is what made a contract named after its own client stutter. */
	.who-contract {
		font-weight: var(--weight-regular);
		color: var(--text-secondary);
	}
	.who-contract::before {
		content: '·';
		margin: 0 0.35em;
		color: var(--text-muted);
	}
	/* The byline. A file name is a reference, so it is typeset as one and
	   truncates instead of wrapping to two bold lines on a phone. */
	.source {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-1) var(--space-3);
		margin: var(--space-1) 0 0;
		font-size: var(--text-sm);
		color: var(--text-muted);
	}
	.source-what {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		flex: 1 1 auto;
		min-width: 0;
	}
	.source-ico {
		flex: none;
	}
	.source-facts {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.source-link {
		flex: none;
		color: var(--color-primary);
	}
	/* Not a flex child of anything stretch-prone (`.decision` is a plain
	   block), so the badge sizes to its own label with no wrapper tricks
	   needed — only spacing, matching the byline's own rhythm above it. */
	.evidence-source {
		margin: var(--space-2) 0 0;
	}

	.proposals {
		display: flex;
		flex-direction: column;
		margin: var(--space-4) 0 0;
		padding: 0;
		list-style: none;
	}
	.proposal {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding-top: var(--space-4);
		border-top: 1px solid var(--border-hairline);
	}
	.proposal:first-child {
		padding-top: 0;
		border-top: 0;
	}
	.proposal + .proposal {
		margin-top: var(--space-4);
	}
	/* What is proposed, and what it costs: the two facts that decide, on one
	   line with the money at the end where a column of them lines up. */
	.what {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-2) var(--space-4);
	}
	.what-title {
		font-size: var(--text-md);
		font-weight: var(--weight-medium);
		color: var(--text-primary);
		text-decoration: none;
	}
	.what-title:hover {
		text-decoration: underline;
	}
	.scope {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}
	/* The client's own sentence the row rests on, evidence for the
	   confidence judgement above it — clamped so a long quote cannot push
	   the row's own accept/reject buttons off screen or widen the card past
	   its neighbours. Unsupported line-clamp just shows the whole excerpt
	   uncut, a fine fallback for a paragraph of text. `overflow-wrap` is for
	   the one token a clamp alone mishandles: verbatim client text can carry
	   a URL or a path longer than the column, which would otherwise clip
	   mid-word with no ellipsis (the clamp's own ellipsis only fires when a
	   *line* is discarded, not on inline overflow within the last one). No
	   margin of its own: `.proposal`'s flex `gap` already spaces every
	   direct child, and margins do not collapse into a flex gap. */
	.excerpt {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-secondary);
		overflow-wrap: anywhere;
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	/* Wraps the badge instead of leaving it a bare flex child of `.proposal`
	   (column direction, stretch by default): a lone `<Badge>` there took the
	   cross-axis stretch onto its own coloured pill and rendered as a
	   full-width bar. `.judgement` below never showed this because its own
	   badge is one of ITS children, not `.proposal`'s directly — same fix,
	   applied here for a lone badge with nothing else to wrap it. */
	.revised {
		display: flex;
		margin: 0;
	}
	/* The terms, as a key/value grid that collapses to one column on a
	   phone rather than squeezing both into 390px. */
	.terms {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-1) var(--space-4);
		margin: 0;
		font-size: var(--text-sm);
	}
	/* Label then value, adjacent. Pushed to opposite ends of a grid column
	   they sat 400px apart on a wide card and stopped reading as a pair. */
	.term {
		display: grid;
		grid-template-columns: minmax(0, 11rem) minmax(0, 1fr);
		gap: var(--space-3);
		min-width: 0;
	}
	.term dt {
		color: var(--text-muted);
	}
	.term dd {
		margin: 0;
		color: var(--text-secondary);
	}
	.judgement {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		margin: 0;
		font-size: var(--text-sm);
	}
	.reason {
		color: var(--text-muted);
	}
	.decide {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	/* A card with one proposal has no "accept all" below it, so its own row
	   carries the primary and is spaced like the card's decision. */
	.decide--only {
		margin-top: var(--space-2);
	}
	.group-decide {
		display: flex;
		justify-content: flex-end;
		margin-top: var(--space-4);
		padding-top: var(--space-4);
		border-top: 1px solid var(--border-hairline);
	}

	/* Decided history stays a row list: once the decision is made the items
	   are homogeneous and comparable, which is what a row is for. */
	.rows {
		display: flex;
		flex-direction: column;
		margin: var(--space-4) 0 0;
		padding: 0;
		list-style: none;
		border: 1px solid var(--border-hairline);
		border-radius: var(--radius-md);
	}
	.row {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
	}
	.row + .row {
		border-top: 1px solid var(--border-hairline);
	}
	.row-ico {
		flex: none;
		margin-top: 0.2em;
		color: var(--text-muted);
	}
	.row-main {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
		flex: 1;
	}
	.row-title {
		font-size: var(--text-md);
		font-weight: var(--weight-medium);
		color: var(--text-primary);
		text-decoration: none;
	}
	a.row-title:hover {
		text-decoration: underline;
	}
	.row-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}
	.reread-note {
		font-size: var(--text-sm);
		color: var(--text-muted);
	}
	.row-actions {
		flex: none;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	@media (max-width: 639px) {
		.terms {
			grid-template-columns: minmax(0, 1fr);
		}
		/* One column wide, a term has room to read label-left value-right
		   without the 11rem label column crushing the value into two lines. */
		.term {
			grid-template-columns: none;
			display: flex;
			justify-content: space-between;
			gap: var(--space-3);
		}
		.term dd {
			text-align: right;
		}
		.row {
			flex-wrap: wrap;
		}
		.row-actions {
			width: 100%;
		}
	}
</style>
