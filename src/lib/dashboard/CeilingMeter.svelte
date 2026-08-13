<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { getLocale } from '$lib/paraglide/runtime';
	import { formatMinorUnits, formatPercent } from '$lib/i18n/format';
	import { STATUS, StatusIndicator } from '$lib/design';
	import {
		ceilingBasisWords,
		ceilingProjectionStatus,
		ceilingStatus,
		type CeilingView
	} from './ceiling';
	import { renewalAssumptionLine } from './renewal-assumption';
	import { minorUnits } from '$lib/money';

	let { view }: { view: CeilingView } = $props();

	// The fiscal engine carries no currency of its own (see
	// `fiscal/ledger.ts`'s `LedgerRow`) — every fixture and every existing
	// contract in this codebase is EUR, so the dashboard reads the same
	// assumption rather than inventing per-figure currency tracking the
	// engine doesn't have.
	const CURRENCY = 'EUR';

	const locale = $derived(getLocale());
	const status = $derived(ceilingStatus(view));
	// #235: the projection note's own status — the headline reads
	// `status` (today's position); this reads `view.projectedEnd`
	// instead, so a calm today with an alarming year-end does not read
	// as calm all the way down.
	const projectionStatus = $derived(ceilingProjectionStatus(view));

	// Headroom above the limit: the fill, the threshold ticks and the
	// dashed projection must all fit inside the track even when the
	// projection — or an already-crossed current value — runs past the
	// limit itself.
	const scaleMax = $derived(
		Math.max(view.limitValue, view.currentValue, view.projectedEnd, 1) * 1.05
	);
	const clampPct = (value: number) => Math.min(100, Math.max(0, value));
	const currentPct = $derived(clampPct((view.currentValue / scaleMax) * 100));
	const limitPct = $derived(clampPct((view.limitValue / scaleMax) * 100));
	const projectedPct = $derived(clampPct((view.projectedEnd / scaleMax) * 100));
	// Below-limit thresholds (e.g. the flat-rate regime's 80%/90%
	// "approaching" mark) get their own tick; the ratio-1 "reached"
	// threshold coincides exactly with the limit line itself, drawn below.
	const thresholds = $derived(view.alertLevels.filter((level) => level.ratio < 1));
</script>

<section class="meter" class:crossed={view.crossed} aria-label={view.label[locale]}>
	<p class="label">{view.label[locale]}</p>
	<div class="headline">
		<span class="figure" style:color={STATUS[status.level]}
			>{formatMinorUnits(view.currentValue, CURRENCY)}</span
		>
		<span class="of"
			>{m.dashboard_ceiling_of({ limit: formatMinorUnits(view.limitValue, CURRENCY) })}</span
		>
	</div>

	<div
		class="track"
		role="progressbar"
		aria-valuemin={0}
		aria-valuemax={view.limitValue}
		aria-valuenow={view.currentValue}
		aria-label={view.label[locale]}
	>
		<div class="fill" style:width="{currentPct}%" style:background={STATUS[status.level]}></div>
		{#each thresholds as level (level.ratio)}
			{@const active = view.activeAlertLevels.includes(level)}
			<div
				class="threshold"
				class:threshold--active={active}
				style:left="{level.ratio * limitPct}%"
				title={level.label[locale]}
			>
				<!-- #235: a permanent, visible label — the tick used to carry
				     its meaning only in a hover `title` and a visually-hidden
				     span, unreadable on the phone this product runs from. -->
				<span class="tick-label" aria-hidden="true">{formatPercent(level.ratio)}</span>
				<span class="sr-only">{level.label[locale]}</span>
			</div>
		{/each}
		<div
			class="limit-mark"
			style:left="{limitPct}%"
			title={m.dashboard_ceiling_limit_mark({ limit: formatMinorUnits(view.limitValue, CURRENCY) })}
		></div>
		<div
			class="projection-mark"
			style:left="{projectedPct}%"
			title={m.dashboard_ceiling_projection_mark({
				amount: formatMinorUnits(view.projectedEnd, CURRENCY)
			})}
		></div>
	</div>
	<div class="track-scale" aria-hidden="true">
		<span>{formatMinorUnits(minorUnits(0), CURRENCY)}</span>
		<span>{formatMinorUnits(view.limitValue, CURRENCY)}</span>
	</div>

	<div class="status-row">
		<StatusIndicator level={status.level} label={status.label} />
		<span class="basis"
			>{m.dashboard_ceiling_basis_intro({ basis: ceilingBasisWords(view.basis) })}</span
		>
	</div>

	{#if view.activeAlertLevels.length > 0}
		<p class="consequence">{view.consequence[locale]}</p>
	{/if}

	<!-- #235: colour and wording now come from `projectionStatus`, not a
	     flat muted footnote — a projection that would cross the ceiling
	     reads as urgent here, not as calm as the good case. -->
	<p
		class="projection-note"
		class:projection-note--emphasized={projectionStatus.level !== 'good'}
		style:color={STATUS[projectionStatus.level]}
	>
		{projectionStatus.label}
	</p>

	{#if view.assumptions.length > 0}
		<div class="assumptions">
			<p class="assumptions-heading">{m.dashboard_assumptions_heading()}</p>
			<ul>
				{#each view.assumptions as assumption (assumption.contractId)}
					<li>{renewalAssumptionLine(assumption)}</li>
				{/each}
			</ul>
		</div>
	{/if}
</section>

<style>
	.meter {
		background: var(--surface-1);
		border: 1px solid var(--border-hairline);
		border-radius: 10px;
		padding: 1.25rem 1.25rem 1.5rem;
	}
	/* #235: a crossed ceiling gets the same status-coloured rail the
	   attention queue and alert list already use for "critical" — the
	   card itself reads urgent on a quick scroll-past, not only its
	   headline number. */
	.meter.crossed {
		box-shadow: inset 3px 0 0 var(--status-critical);
	}
	.label {
		margin: 0 0 0.375rem;
		color: var(--text-secondary);
		font-size: 0.8125rem;
	}
	.headline {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.figure {
		font-size: clamp(1.75rem, 6vw, 2.5rem);
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		color: var(--text-primary);
		line-height: 1.1;
	}
	.of {
		color: var(--text-muted);
		font-size: 0.9375rem;
		font-variant-numeric: tabular-nums;
	}
	.track {
		position: relative;
		margin-top: 1rem;
		height: 0.875rem;
		border-radius: 999px;
		background: var(--grid-line);
		overflow: visible;
	}
	.fill {
		position: absolute;
		inset: 0 auto 0 0;
		height: 100%;
		border-radius: 999px 0 0 999px;
		transition: width 0.2s ease-out;
	}
	.threshold {
		position: absolute;
		top: -0.1875rem;
		bottom: -0.1875rem;
		width: 2px;
		background: var(--text-muted);
		transform: translateX(-1px);
	}
	.threshold--active {
		background: var(--status-warning);
	}
	/* #235: a permanent label, not a hover-only title — the smallest
	   legible size on the scale (`--text-2xs`'s own 11px, kept as a raw
	   value here since this SVG-adjacent track already sizes by hand). */
	.tick-label {
		position: absolute;
		top: -1.05rem;
		left: 50%;
		transform: translateX(-50%);
		font-size: 0.625rem;
		font-variant-numeric: tabular-nums;
		color: var(--text-muted);
		white-space: nowrap;
	}
	.threshold--active .tick-label {
		color: var(--status-warning);
		font-weight: 600;
	}
	.limit-mark {
		position: absolute;
		top: -0.3125rem;
		bottom: -0.3125rem;
		width: 2px;
		background: var(--text-primary);
		transform: translateX(-1px);
	}
	.projection-mark {
		position: absolute;
		top: -0.3125rem;
		bottom: -0.3125rem;
		width: 0;
		border-left: 2px dashed var(--text-primary);
		transform: translateX(-1px);
	}
	.track-scale {
		margin-top: 0.375rem;
		display: flex;
		justify-content: space-between;
		font-size: 0.6875rem;
		font-variant-numeric: tabular-nums;
		color: var(--text-muted);
	}
	.status-row {
		margin-top: 0.875rem;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 0.875rem;
	}
	.basis {
		color: var(--text-secondary);
		font-size: 0.8125rem;
	}
	.consequence {
		margin: 0.75rem 0 0;
		padding: 0.625rem 0.75rem;
		border-radius: 6px;
		background: var(--grid-line);
		color: var(--text-primary);
		font-size: 0.8125rem;
	}
	.projection-note {
		margin: 0.625rem 0 0;
		font-size: 0.75rem;
	}
	/* #235: a projected breach reads larger and bolder, not just a
	   different colour — "does not read as calm" needs a second cue
	   beyond hue, same rule as everywhere else in this system. */
	.projection-note--emphasized {
		font-size: 0.8125rem;
		font-weight: 600;
	}
	.assumptions {
		margin-top: 0.5rem;
		padding-top: 0.5rem;
		border-top: 1px dashed var(--border-hairline);
	}
	.assumptions-heading {
		margin: 0;
		color: var(--text-secondary);
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.02em;
	}
	.assumptions ul {
		margin: 0.375rem 0 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.assumptions li {
		color: var(--text-muted);
		font-size: 0.75rem;
		overflow-wrap: anywhere;
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
</style>
