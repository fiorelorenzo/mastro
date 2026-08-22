<!--
	One extraction run, live or replayed (#278,
	`docs/specs/2026-08-15-extraction-runs-design.md`, "The three views" A
	and B). The server-rendered markup is already the whole story — state,
	document, elapsed/total time, outcome, transcript — with no
	JavaScript: the design doc's own reasoning ("a run has no JavaScript
	guarantee"). When the run has not yet reached `applied`/`failed`, the
	browser opens `/import/runs/[id]/stream` and appends what arrives onto
	the same markup, so a live run and a finished one read identically —
	the point of storing every event as a row instead of keeping a
	transcript column only outcomes replace.
-->
<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import { formatDateTime, formatDuration } from '$lib/i18n/format';
	import { Badge, Banner, Button } from '$lib/design';
	import Page from '$lib/layout/Page.svelte';
	import { retryEligibility } from '$lib/extraction/retry-eligibility';
	import {
		coalesceEvents,
		failureSummary,
		isTerminalRunStatus,
		retryBlockReasonMessage,
		runDurationSeconds,
		runEventKindBadge,
		runStatusBadge,
		targetTypeLabel,
		type ExtractionRunStatusValue,
		type RunEventKindValue
	} from '../run-status';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	interface LiveEvent {
		seq: number;
		at: string;
		kind: RunEventKindValue;
		payload: string;
	}

	interface StreamEventMessage {
		type: 'event';
		seq: number;
		at: string;
		kind: string;
		payload: string;
	}

	interface StreamStatusMessage {
		type: 'status';
		status: string;
		error: string | null;
		proposalId: string | null;
	}

	function toLiveEvent(event: {
		seq: number;
		at: Date | string;
		kind: string;
		payload: string;
	}): LiveEvent {
		return {
			seq: event.seq,
			at: event.at instanceof Date ? event.at.toISOString() : event.at,
			kind: event.kind as RunEventKindValue,
			payload: event.payload
		};
	}

	// The snapshot every render starts from — reset whenever `data` itself
	// changes (a fresh `load`, or navigating from one run's page straight
	// to another without a full remount). Read from `data` only, never
	// from the live state below, so this can never become the second half
	// of a feedback loop with the stream effect underneath it.
	let events = $state<LiveEvent[]>(data.events.map(toLiveEvent));
	let status = $state<ExtractionRunStatusValue>(data.run.status);
	let error = $state<string | null>(data.run.error);
	let failureKind = $state(data.run.failureKind);
	let proposalId = $state<string | null>(data.proposalId);
	let finishedAt = $state<Date | null>(data.run.finishedAt);

	// Chunk boundaries are transport, not meaning — see `coalesceEvents`.
	const blocks = $derived(coalesceEvents(events));

	$effect(() => {
		events = data.events.map(toLiveEvent);
		status = data.run.status;
		error = data.run.error;
		failureKind = data.run.failureKind;
		proposalId = data.proposalId;
		finishedAt = data.run.finishedAt;
	});

	// Opens once per run, only when it is not already terminal at load
	// time — gated on `data.run.status`, never on the live `status` above,
	// so a status this same effect's own listener writes can never make it
	// tear down and reopen a perfectly good connection. The listener
	// closes the source itself the moment a terminal status arrives,
	// rather than leaving that to reactivity, for the same reason: closing
	// has to happen exactly once, immediately, not on the next effect run.
	$effect(() => {
		if (isTerminalRunStatus(data.run.status)) return;

		const source = new EventSource(resolve('/import/runs/[id=uuid]/stream', { id: data.run.id }));
		source.onmessage = (message) => {
			const parsed = JSON.parse(message.data) as StreamEventMessage | StreamStatusMessage;
			if (parsed.type === 'event') {
				if (events.some((existing) => existing.seq === parsed.seq)) return;
				events = [...events, toLiveEvent(parsed)].toSorted((a, b) => a.seq - b.seq);
				return;
			}
			status = parsed.status as ExtractionRunStatusValue;
			error = parsed.error;
			proposalId = parsed.proposalId;
			if (isTerminalRunStatus(status)) {
				finishedAt = new Date();
				source.close();
			}
		};

		return () => source.close();
	});

	const statusBadge = $derived(runStatusBadge(status));
	const durationSeconds = $derived(
		runDurationSeconds({ enqueuedAt: data.run.enqueuedAt, finishedAt })
	);
	const documentName = $derived(
		data.documentOriginalName ?? m.extraction_run_registry_document_unknown()
	);
	const elapsedLabel = $derived(
		isTerminalRunStatus(status)
			? m.extraction_run_detail_duration_label()
			: m.extraction_run_detail_elapsed_label()
	);

	// Live, off the same `status`/`failureKind` the SSE listener already
	// updates (#315) — `data.retryAttemptCount`/`data.retryHasProposals`
	// stay from load, since neither changes for the lifetime of this run:
	// only a *different* run (a retry of this one) could move them, and
	// that lands on its own page. The server action re-checks all four
	// facts fresh before it acts; this only decides what to render.
	const retry = $derived(
		retryEligibility({
			isFailed: status === 'failed',
			failureKind,
			attemptCount: data.retryAttemptCount,
			hasProposals: data.retryHasProposals
		})
	);

	// Long model output stays readable without collapsing the transcript
	// into a wall of text, and without any JavaScript to drive a
	// show/hide toggle — `<details>` does that natively. Short payloads
	// render already open, so the common case (a short tool result, a
	// one-line plan) never needs a click.
	const PAYLOAD_PREVIEW_THRESHOLD = 240;

	function isLongPayload(payload: string): boolean {
		return payload.length > PAYLOAD_PREVIEW_THRESHOLD || payload.includes('\n\n');
	}

	function payloadPreview(payload: string): string {
		const firstLine = payload.split('\n', 1)[0];
		const preview =
			firstLine.length > PAYLOAD_PREVIEW_THRESHOLD
				? firstLine.slice(0, PAYLOAD_PREVIEW_THRESHOLD)
				: firstLine;
		return preview.length < payload.length ? `${preview}…` : preview;
	}
</script>

<svelte:head><title>{m.extraction_run_detail_page_title()}</title></svelte:head>

<Page title={documentName} subtitle={targetTypeLabel(data.run.targetType)} width="wide">
	{#snippet actions()}
		<Button href={resolve('/import/runs')} variant="secondary" size="sm">
			{m.extraction_run_detail_back_link()}
		</Button>
	{/snippet}

	<div class="state-row">
		<Badge variant={statusBadge.variant} label={statusBadge.label} />
	</div>

	<dl class="pairs">
		<dt>{elapsedLabel}</dt>
		<dd>{formatDuration(durationSeconds)}</dd>
	</dl>

	{#if status === 'applied' && proposalId}
		<p class="outcome-success">
			{m.extraction_run_detail_outcome_applied()}
			<a href={resolve('/proposals/[id=uuid]', { id: proposalId })}>
				{m.extraction_run_detail_outcome_proposal_link()}
			</a>
		</p>
	{:else if status === 'nothing_proposed'}
		<!-- #398: a terminal outcome that is neither a proposal nor a failure.
		     Said plainly, because a reader arrives here expecting one of those
		     two and would otherwise be left inferring which one this is. -->
		<p class="outcome-success">{m.extraction_run_detail_outcome_nothing_proposed()}</p>
	{:else if status === 'failed'}
		<Banner tone="critical">
			<strong>{m.extraction_run_detail_outcome_failed_heading()}</strong>
			<!-- The kind first, in the reader's own language, and the run's own
			     diagnostic under it. That diagnostic is what made #283 findable
			     in twenty-seven seconds, so it stays verbatim and visible — but
			     it is a model's English, not a sentence anybody should be asked
			     to interpret unaided. A run that failed before `failureKind`
			     existed has none, and then the diagnostic alone is exactly what
			     this screen showed before. -->
			{#if failureKind}
				<p>{failureSummary(failureKind)}</p>
			{/if}
			{#if error}
				<p class="error-label">{m.extraction_run_failure_detail_heading()}</p>
				<p class="error-detail">{error}</p>
			{/if}
		</Banner>
		{#if retry.canRetry}
			<form method="POST" action="?/retry" class="retry-form">
				<Button type="submit" variant="primary">{m.extraction_run_retry_button()}</Button>
			</form>
		{:else if retry.reason}
			<p class="retry-note">{retryBlockReasonMessage(retry.reason)}</p>
		{/if}
		{#if form?.retryError}
			<p class="error-label">{form.retryError}</p>
		{/if}
	{/if}

	<section class="transcript">
		<h2>{m.extraction_run_detail_transcript_heading()}</h2>
		{#if blocks.length === 0}
			<p class="muted">{m.extraction_run_detail_transcript_empty()}</p>
		{:else}
			<ol class="events">
				{#each blocks as block (block.seq)}
					{@const kindBadge = runEventKindBadge(block.kind)}
					<li class="event">
						<div class="event-head">
							<Badge variant={kindBadge.variant} label={kindBadge.label} size="sm" />
							<time datetime={block.at}>{formatDateTime(block.at)}</time>
						</div>
						{#if isLongPayload(block.payload)}
							<details>
								<summary>{payloadPreview(block.payload)}</summary>
								<p class="payload">{block.payload}</p>
							</details>
						{:else}
							<p class="payload">{block.payload}</p>
						{/if}
					</li>
				{/each}
			</ol>
		{/if}
	</section>
</Page>

<style>
	.state-row {
		margin-top: var(--space-3);
	}
	.pairs {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: var(--space-1) var(--space-4);
		margin: var(--space-4) 0;
		font-size: var(--text-sm);
	}
	.pairs dt {
		color: var(--text-secondary);
	}
	.pairs dd {
		margin: 0;
		color: var(--text-primary);
	}
	.outcome-success {
		margin: var(--space-4) 0 0;
		font-size: var(--text-sm);
		color: var(--status-good);
	}
	.outcome-success a {
		color: var(--color-primary);
	}
	.retry-form {
		margin-top: var(--space-4);
	}
	.retry-note {
		margin: var(--space-4) 0 0;
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}
	.error-detail {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		white-space: pre-wrap;
	}
	.transcript {
		margin-top: var(--space-6);
	}
	.transcript h2 {
		font-size: var(--text-lg);
		font-weight: var(--weight-medium);
		margin-bottom: var(--space-3);
	}
	.muted {
		color: var(--text-muted);
	}
	.events {
		display: flex;
		flex-direction: column;
		margin: 0;
		padding: 0;
		list-style: none;
		border: 1px solid var(--border-hairline);
		border-radius: var(--radius-md);
	}
	.event {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-4);
	}
	.event + .event {
		border-top: 1px solid var(--border-hairline);
	}
	.event-head {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}
	.event-head time {
		font-size: var(--text-xs);
		color: var(--text-muted);
	}
	.payload {
		margin: 0;
		white-space: pre-wrap;
		font-size: var(--text-sm);
		color: var(--text-primary);
	}
	summary {
		cursor: pointer;
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}
	summary::marker {
		color: var(--text-muted);
	}
	details[open] summary {
		margin-bottom: var(--space-2);
	}
</style>
