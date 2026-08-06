<script lang="ts">
	import Axis from '$lib/design/charts/Axis.svelte';
	import ChartFrame from '$lib/design/charts/ChartFrame.svelte';
	import DataTable from '$lib/design/charts/DataTable.svelte';
	import Grid from '$lib/design/charts/Grid.svelte';
	import Legend from '$lib/design/charts/Legend.svelte';
	import StatusIndicator from '$lib/design/charts/StatusIndicator.svelte';
	import Tooltip from '$lib/design/charts/Tooltip.svelte';
	import type { SeriesEntry, StatusEntry, TableColumn, TooltipRow } from '$lib/design/charts/types';
	import { SvelteSet } from 'svelte/reactivity';
	import {
		CATEGORICAL,
		CERTAINTY_TIERS,
		SEQUENTIAL,
		SEQUENTIAL_STEPS,
		STATUS,
		STATUS_LEVELS,
		categorical,
		type ColorScheme,
		type StatusLevel
	} from '$lib/design/palette';
	import { validate, validateOrdinal, type ValidationResult } from '$lib/design/palette-validator';

	// ── theme control — deterministic for review and for screenshot testing,
	// rather than relying only on the OS setting. ──────────────────────────
	let theme: 'system' | ColorScheme = $state('system');
	function setTheme(next: typeof theme) {
		theme = next;
		if (typeof document === 'undefined') return;
		if (next === 'system') document.documentElement.removeAttribute('data-theme');
		else document.documentElement.dataset.theme = next;
	}

	// ── status demo labels — illustrative, no ceiling/day data (see #57-#59) ──
	const statusExamples: Record<StatusLevel, string> = {
		good: 'On track',
		warning: 'Approaching the ceiling',
		serious: 'Over the planned pace',
		critical: 'Ceiling exceeded'
	};
	const statusLegendEntries: StatusEntry[] = STATUS_LEVELS.map((level) => ({
		level,
		label: statusExamples[level]
	}));

	// ── validator report — the acceptance bullet made visible, not just prose ──
	const categoricalReports: Record<ColorScheme, ValidationResult> = {
		light: validate(categorical('light'), { mode: 'light' }),
		dark: validate(categorical('dark'), { mode: 'dark' })
	};
	const ordinalReports: Record<ColorScheme, ValidationResult> = {
		light: validateOrdinal([SEQUENTIAL[650], SEQUENTIAL[450], SEQUENTIAL[250]], { mode: 'light' }),
		dark: validateOrdinal([SEQUENTIAL[600], SEQUENTIAL[350], SEQUENTIAL[150]], { mode: 'dark' })
	};
	interface CheckRowView {
		check: string;
		state: string;
		detail: string;
	}
	const reportColumns: TableColumn<CheckRowView>[] = [
		{ key: 'check', label: 'Check' },
		{ key: 'state', label: 'Result' },
		{ key: 'detail', label: 'Detail' }
	];
	function toRows(result: ValidationResult): CheckRowView[] {
		return result.report.map((row) => ({
			check: row.name,
			state: String(row.state).toUpperCase(),
			detail: row.detail
		}));
	}

	// ── illustrative grouped-bar demo — fake categories, proves composition ──
	const demoData = [
		{ category: 'Alpha', seriesA: 42, seriesB: 18 },
		{ category: 'Beta', seriesA: 27, seriesB: 33 },
		{ category: 'Gamma', seriesA: 51, seriesB: 12 },
		{ category: 'Delta', seriesA: 15, seriesB: 24 }
	];
	const flaggedCategory = 'Gamma';
	const demoSeries: SeriesEntry[] = [
		{ id: 'seriesA', label: 'Series A', color: CATEGORICAL[0].light, mark: 'rect' },
		{ id: 'seriesB', label: 'Series B', color: CATEGORICAL[1].light, mark: 'rect' }
	];
	const demoColumns: TableColumn<(typeof demoData)[number]>[] = [
		{ key: 'category', label: 'Category' },
		{ key: 'seriesA', label: 'Series A', align: 'end', format: (r) => String(r.seriesA) },
		{ key: 'seriesB', label: 'Series B', align: 'end', format: (r) => String(r.seriesB) }
	];

	const rowHeight = 44;
	const barThickness = 14;
	const barGap = 2;
	const plotWidth = 260;
	const plotHeight = demoData.length * rowHeight;
	const maxValue = 60;
	const xTickValues = [0, 20, 40, 60];
	const xScale = (value: number) => (value / maxValue) * plotWidth;

	let activeSeries: ReadonlySet<string> | undefined = $state(undefined);
	function toggleSeries(id: string) {
		const current = activeSeries ?? new SvelteSet(demoSeries.map((s) => s.id));
		const next = new SvelteSet(current);
		if (next.has(id) && next.size === 1) return; // never isolate down to zero series
		if (next.has(id)) next.delete(id);
		else next.add(id);
		activeSeries = next.size === demoSeries.length ? undefined : next;
	}

	let tooltip: { x: number; y: number; rows: TooltipRow[] } | null = $state(null);
	function showTooltip(row: (typeof demoData)[number], event: { currentTarget: SVGElement }) {
		const box = (event.currentTarget as SVGGraphicsElement).getBoundingClientRect();
		const parent = (event.currentTarget as SVGElement)
			.closest('.plot-wrap')
			?.getBoundingClientRect();
		if (!parent) return;
		tooltip = {
			x: box.left - parent.left + box.width / 2,
			y: box.top - parent.top,
			rows: [
				{ label: 'Series A', value: String(row.seriesA), color: CATEGORICAL[0].light },
				{ label: 'Series B', value: String(row.seriesB), color: CATEGORICAL[1].light }
			]
		};
	}
	function hideTooltip() {
		tooltip = null;
	}
</script>

<svelte:head><title>mastro — design system</title></svelte:head>

<main class="page">
	<header class="intro">
		<div>
			<h1>Visual system</h1>
			<p>
				Chart color tokens and the shared primitives that will build the dashboard's ceiling meter,
				cash calendar and client-concentration chart (#57&ndash;#59). This route renders the system
				for review — it is not a dashboard screen, and nothing on it is real data.
			</p>
		</div>
		<div class="theme-toggle" role="group" aria-label="Color scheme">
			{#each ['system', 'light', 'dark'] as const as option (option)}
				<button type="button" class:active={theme === option} onclick={() => setTheme(option)}>
					{option}
				</button>
			{/each}
		</div>
	</header>

	<section>
		<h2>Categorical palette</h2>
		<p class="lede">
			Eight hues, fixed order, assigned in sequence — never cycled. Identity only; swapping the
			order would not change meaning.
		</p>
		<ul class="swatch-row">
			{#each CATEGORICAL as slot (slot.slot)}
				<li class="swatch">
					<span class="chip" style:background="var(--series-{slot.slot})"></span>
					<span class="chip-label">{slot.slot}. {slot.hue}</span>
					<span class="chip-hex">{slot.light} / {slot.dark}</span>
				</li>
			{/each}
		</ul>
	</section>

	<section>
		<h2>Sequential ramp</h2>
		<p class="lede">
			One hue (blue), light&rarr;dark, for continuous magnitude. The three highlighted steps are the
			certainty ramp&nbsp;&mdash; committed (most certain) through pipeline (least), a magnitude,
			not an identity, so it is one hue, not three colors.
		</p>
		<ul class="ramp-row">
			{#each SEQUENTIAL_STEPS as step (step)}
				<li class="ramp-step" style:background={SEQUENTIAL[step]}>
					<span class="ramp-step-label">{step}</span>
				</li>
			{/each}
		</ul>
		<ul class="swatch-row">
			{#each CERTAINTY_TIERS as tier (tier)}
				<li class="swatch">
					<span class="chip" style:background="var(--certainty-{tier})"></span>
					<span class="chip-label">{tier}</span>
				</li>
			{/each}
		</ul>
	</section>

	<section>
		<h2>Status palette</h2>
		<p class="lede">
			A fixed scale, distinct from the categorical slots, never conveyed by colour alone: every
			status carries its own outline shape and glyph as well as this label text.
		</p>
		<ul class="status-row">
			{#each STATUS_LEVELS as level (level)}
				<li>
					<StatusIndicator {level} label={statusExamples[level]} />
					<code>{STATUS[level]}</code>
				</li>
			{/each}
		</ul>
	</section>

	<section>
		<h2>Surfaces &amp; chrome</h2>
		<p class="lede">
			Dark is its own set of steps, not an inverted light theme — use the scheme toggle above to
			compare.
		</p>
		<ul class="surface-row">
			<li><span class="chip" style:background="var(--surface-1)"></span>surface</li>
			<li><span class="chip" style:background="var(--surface-page)"></span>page</li>
			<li><span class="chip" style:background="var(--grid-line)"></span>gridline</li>
			<li><span class="chip" style:background="var(--axis-line)"></span>axis</li>
			<li><span class="chip" style:background="var(--text-primary)"></span>text primary</li>
			<li><span class="chip" style:background="var(--text-secondary)"></span>text secondary</li>
			<li><span class="chip" style:background="var(--text-muted)"></span>text muted</li>
			<li><span class="chip" style:background="var(--delta-good)"></span>delta good</li>
		</ul>
	</section>

	<section>
		<h2>Validator report</h2>
		<p class="lede">
			The palette is validated with a checker, not by eye: OKLCH lightness band, chroma floor, CVD
			separation (protan/deutan simulated, Machado&ndash;Oliveira&ndash;Fernandes 2009), a
			normal-vision separation floor, and contrast against each surface. Run once per scheme — dark
			is validated on its own steps, not derived from light. The same checks run as
			<code>pnpm test</code> assertions in <code>palette.test.ts</code>.
		</p>
		<div class="report-grid">
			{#each ['light', 'dark'] as const as scheme (scheme)}
				<div>
					<h3>Categorical &mdash; {scheme}</h3>
					<DataTable columns={reportColumns} rows={toRows(categoricalReports[scheme])} />
				</div>
			{/each}
			{#each ['light', 'dark'] as const as scheme (scheme)}
				<div>
					<h3>Certainty ramp (ordinal) &mdash; {scheme}</h3>
					<DataTable columns={reportColumns} rows={toRows(ordinalReports[scheme])} />
				</div>
			{/each}
		</div>
	</section>

	<section>
		<h2>Chart primitives</h2>
		<p class="lede">
			Axes, grid, legend, tooltip and the table-view toggle, composed into one illustrative chart.
			Fake categories, not client data — the point is the primitives, not this chart.
		</p>
		<ChartFrame
			title="Illustrative comparison"
			caption="Two series across four made-up categories. Not real data."
			columns={demoColumns}
			rows={demoData}
		>
			{#snippet chart()}
				<div class="plot-wrap">
					<svg
						viewBox="-70 -8 {plotWidth + 90} {plotHeight + 32}"
						width={plotWidth + 90}
						height={plotHeight + 32}
						role="img"
						aria-label="Illustrative comparison of Series A and Series B across four categories"
					>
						<g transform="translate(0, 0)">
							<Grid orientation="vertical" lines={xTickValues.map(xScale)} length={plotHeight} />
							{#each demoData as row, i (row.category)}
								{@const rowY = i * rowHeight}
								{@const aActive = activeSeries === undefined || activeSeries.has('seriesA')}
								{@const bActive = activeSeries === undefined || activeSeries.has('seriesB')}
								<rect
									x="0"
									y={rowY}
									width={xScale(row.seriesA)}
									height={barThickness}
									rx="2"
									fill="var(--series-1)"
									opacity={aActive ? 1 : 0.2}
									tabindex="0"
									role="button"
									aria-label="{row.category} series A {row.seriesA}"
									onpointermove={(e) => showTooltip(row, e)}
									onfocus={(e) => showTooltip(row, e)}
									onpointerleave={hideTooltip}
									onblur={hideTooltip}
								/>
								<rect
									x="0"
									y={rowY + barThickness + barGap}
									width={xScale(row.seriesB)}
									height={barThickness}
									rx="2"
									fill="var(--series-2)"
									opacity={bActive ? 1 : 0.2}
									tabindex="0"
									role="button"
									aria-label="{row.category} series B {row.seriesB}"
									onpointermove={(e) => showTooltip(row, e)}
									onfocus={(e) => showTooltip(row, e)}
									onpointerleave={hideTooltip}
									onblur={hideTooltip}
								/>
								{#if row.category === flaggedCategory}
									<foreignObject x={xScale(row.seriesA) + 10} y={rowY - 2} width="150" height="20">
										<StatusIndicator level="warning" label="Above target" />
									</foreignObject>
								{/if}
							{/each}
							<Axis
								orientation="y"
								length={plotHeight}
								ticks={demoData.map((row, i) => ({
									position: i * rowHeight + (barThickness + barGap / 2),
									label: row.category
								}))}
							/>
							<g transform="translate(0, {plotHeight})">
								<Axis
									orientation="x"
									length={plotWidth}
									ticks={xTickValues.map((v) => ({ position: xScale(v), label: String(v) }))}
								/>
							</g>
						</g>
					</svg>
					{#if tooltip}
						<Tooltip x={tooltip.x} y={tooltip.y} rows={tooltip.rows} />
					{/if}
				</div>
				<Legend
					entries={demoSeries}
					activeIds={activeSeries}
					onToggle={toggleSeries}
					statusEntries={statusLegendEntries}
				/>
				<div class="status-pairing-note">
					<StatusIndicator level="warning" label="Above target" /> pairs the warning color with a triangle
					glyph and this label on the chart itself, not only in a legend.
				</div>
			{/snippet}
		</ChartFrame>
	</section>
</main>

<style>
	.page {
		max-width: 60rem;
		margin: 0 auto;
		padding: 2rem 1.25rem 4rem;
		background: var(--surface-page);
		color: var(--text-primary);
	}
	.intro {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 2.5rem;
	}
	.intro p {
		max-width: 40rem;
		color: var(--text-secondary);
		font-size: 0.875rem;
	}
	h1 {
		margin: 0 0 0.5rem;
		font-size: 1.5rem;
	}
	h2 {
		margin: 0 0 0.25rem;
		font-size: 1.125rem;
		border-top: 1px solid var(--border-hairline);
		padding-top: 1.5rem;
	}
	h3 {
		margin: 0 0 0.5rem;
		font-size: 0.875rem;
		color: var(--text-secondary);
	}
	section {
		margin-bottom: 2rem;
	}
	.lede {
		margin: 0 0 1rem;
		max-width: 42rem;
		color: var(--text-secondary);
		font-size: 0.8125rem;
	}
	.theme-toggle {
		display: inline-flex;
		border: 1px solid var(--border-hairline);
		border-radius: 6px;
		overflow: hidden;
	}
	.theme-toggle button {
		border: none;
		background: none;
		padding: 0.375rem 0.75rem;
		color: var(--text-secondary);
		font: inherit;
		font-size: 0.75rem;
		text-transform: capitalize;
		cursor: pointer;
	}
	.theme-toggle button.active {
		background: var(--text-primary);
		color: var(--surface-1);
	}
	.swatch-row,
	.status-row,
	.surface-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem 1.5rem;
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.swatch {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		width: 9rem;
	}
	.chip {
		display: inline-block;
		width: 2.5rem;
		height: 1.5rem;
		border-radius: 4px;
		border: 1px solid var(--border-hairline);
	}
	.chip-label {
		font-size: 0.75rem;
		text-transform: capitalize;
	}
	.chip-hex {
		font-size: 0.6875rem;
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}
	.status-row {
		align-items: center;
	}
	.status-row li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.status-row code {
		color: var(--text-muted);
		font-size: 0.6875rem;
	}
	.surface-row li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.75rem;
		color: var(--text-secondary);
	}
	.surface-row .chip {
		width: 1.75rem;
		height: 1.75rem;
	}
	.ramp-row {
		display: flex;
		list-style: none;
		margin: 0 0 1rem;
		padding: 0;
		border-radius: 6px;
		overflow: hidden;
		border: 1px solid var(--border-hairline);
	}
	.ramp-step {
		flex: 1;
		height: 2.5rem;
		display: flex;
		align-items: flex-end;
		justify-content: center;
		padding-bottom: 0.125rem;
	}
	.ramp-step-label {
		font-size: 0.5625rem;
		color: rgba(0, 0, 0, 0.45);
		font-variant-numeric: tabular-nums;
	}
	.report-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
		gap: 1.5rem;
	}
	.plot-wrap {
		position: relative;
	}
	.status-pairing-note {
		margin-top: 0.75rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--text-secondary);
		font-size: 0.75rem;
	}
</style>
