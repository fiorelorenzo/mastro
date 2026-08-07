<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import * as m from '$lib/paraglide/messages';
	import { getLocale } from '$lib/paraglide/runtime';
	import { formatMinorUnits, formatPercent } from '$lib/i18n/format';
	import { ChartFrame, Legend } from '$lib/design';
	import type { SeriesEntry, TableColumn } from '$lib/design';
	import {
		assignClientColors,
		type ClientShare,
		type ShareCeilingReference
	} from './concentration';

	let {
		byClient,
		total,
		shareCeilings
	}: {
		byClient: readonly ClientShare[];
		total: number;
		shareCeilings: readonly ShareCeilingReference[];
	} = $props();

	const CURRENCY = 'EUR';
	const locale = $derived(getLocale());

	// Colour identity is fixed once, from every client id in the breakdown
	// — never recomputed from whatever subset the legend currently shows.
	const colorByClient = $derived(assignClientColors(byClient.map((share) => share.clientId)));
	// Display order is by share, descending — readability, not identity —
	// while `colorByClient` above stays keyed to the id regardless of it.
	const sortedByShare = $derived([...byClient].sort((a, b) => b.amount - a.amount));

	const rowHeight = 32;
	const barThickness = 16;
	const plotWidth = 240;
	const plotHeight = $derived(sortedByShare.length * rowHeight);

	let activeClientIds: ReadonlySet<string> | undefined = $state(undefined);
	function toggleClient(clientId: string) {
		const current = activeClientIds ?? new SvelteSet(byClient.map((share) => share.clientId));
		const next = new SvelteSet(current);
		if (next.has(clientId) && next.size === 1) return; // never isolate down to zero clients
		if (next.has(clientId)) next.delete(clientId);
		else next.add(clientId);
		activeClientIds = next.size === byClient.length ? undefined : next;
	}

	const legendEntries = $derived<SeriesEntry[]>(
		sortedByShare.map((share) => ({
			id: share.clientId,
			label: share.clientName,
			color: colorByClient.get(share.clientId) ?? 'var(--series-1)',
			mark: 'rect'
		}))
	);

	interface ClientRow {
		clientId: string;
		clientName: string;
		amount: number;
		share: number;
	}
	const rows = $derived<ClientRow[]>(
		sortedByShare.map((share) => ({
			clientId: share.clientId,
			clientName: share.clientName,
			amount: share.amount,
			share: total > 0 ? share.amount / total : 0
		}))
	);
	const columns: TableColumn<ClientRow>[] = [
		{ key: 'clientName', label: m.dashboard_concentration_column_client() },
		{
			key: 'share',
			label: m.dashboard_concentration_column_share(),
			align: 'end',
			format: (r) => formatPercent(r.share)
		},
		{
			key: 'amount',
			label: m.dashboard_concentration_column_amount(),
			align: 'end',
			format: (r) => formatMinorUnits(r.amount, CURRENCY)
		}
	];
</script>

{#if byClient.length === 0}
	<p class="empty">{m.dashboard_concentration_empty()}</p>
{:else}
	<ChartFrame
		title={m.dashboard_concentration_title()}
		caption={m.dashboard_concentration_caption()}
		{columns}
		{rows}
	>
		{#snippet chart()}
			<div class="plot-wrap">
				<svg
					viewBox="-170 -8 {plotWidth + 220} {plotHeight + 24}"
					width={plotWidth + 220}
					height={plotHeight + 24}
					role="img"
					aria-label={m.dashboard_concentration_title()}
				>
					{#each shareCeilings as ceiling (ceiling.id)}
						<line
							x1={ceiling.ratio * plotWidth}
							y1={-4}
							x2={ceiling.ratio * plotWidth}
							y2={plotHeight}
							class="reference-line"
							class:crossed={ceiling.crossed}
						/>
					{/each}
					{#each sortedByShare as share, index (share.clientId)}
						{@const active = activeClientIds === undefined || activeClientIds.has(share.clientId)}
						{@const ratio = total > 0 ? share.amount / total : 0}
						{@const y = index * rowHeight}
						<rect
							x="0"
							{y}
							width={ratio * plotWidth}
							height={barThickness}
							rx="2"
							style:fill={colorByClient.get(share.clientId)}
							opacity={active ? 1 : 0.2}
						/>
						<text
							x="-10"
							y={y + barThickness / 2}
							class="row-label"
							text-anchor="end"
							opacity={active ? 1 : 0.35}
						>
							{share.clientName}
						</text>
						<text
							x={ratio * plotWidth + 6}
							y={y + barThickness / 2}
							class="row-value"
							opacity={active ? 1 : 0.35}
						>
							{formatPercent(ratio)}
						</text>
					{/each}
				</svg>
			</div>
			<Legend entries={legendEntries} activeIds={activeClientIds} onToggle={toggleClient} />
			{#each shareCeilings as ceiling (ceiling.id)}
				<p class="reference-note" class:crossed={ceiling.crossed}>
					<strong>{ceiling.label[locale]}</strong>
					{m.dashboard_concentration_reference_at({ percent: formatPercent(ceiling.ratio) })}
					{ceiling.consequence[locale]}
				</p>
			{/each}
		{/snippet}
	</ChartFrame>
{/if}

<style>
	.plot-wrap {
		position: relative;
	}
	.plot-wrap svg {
		/* Tailwind's preflight sets `svg { max-width: 100% }`, which would
		   shrink this chart to fit its container instead of letting
		   ChartFrame's own `overflow-x: auto` scroll it at native size. */
		max-width: none;
	}
	.row-label {
		fill: var(--text-secondary);
		font-size: 11px;
		dominant-baseline: middle;
	}
	.row-value {
		fill: var(--text-primary);
		font-size: 11px;
		font-variant-numeric: tabular-nums;
		dominant-baseline: middle;
	}
	.reference-line {
		stroke: var(--text-primary);
		stroke-width: 1.5;
		stroke-dasharray: 3 3;
	}
	.reference-line.crossed {
		stroke: var(--status-critical);
		stroke-width: 2;
	}
	.reference-note {
		margin: 0.625rem 0 0;
		padding: 0.5rem 0.75rem;
		border-radius: 6px;
		background: var(--grid-line);
		color: var(--text-primary);
		font-size: 0.8125rem;
	}
	.reference-note.crossed {
		border: 1px solid var(--status-critical);
	}
	.empty {
		color: var(--text-secondary);
		font-size: 0.875rem;
	}
</style>
