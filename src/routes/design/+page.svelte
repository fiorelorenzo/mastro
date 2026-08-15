<script lang="ts">
	import Axis from '$lib/design/charts/Axis.svelte';
	import ChartFrame from '$lib/design/charts/ChartFrame.svelte';
	import DataTable from '$lib/design/charts/DataTable.svelte';
	import Grid from '$lib/design/charts/Grid.svelte';
	import Legend from '$lib/design/charts/Legend.svelte';
	import StatusIndicator from '$lib/design/charts/StatusIndicator.svelte';
	import Tooltip from '$lib/design/charts/Tooltip.svelte';
	import type { SeriesEntry, StatusEntry, TableColumn, TooltipRow } from '$lib/design/charts/types';
	import Page from '$lib/layout/Page.svelte';
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
	import Amount from '$lib/design/Amount.svelte';
	import AmountInput from '$lib/design/AmountInput.svelte';
	import Badge from '$lib/design/Badge.svelte';
	import { BADGE_SIZES, BADGE_VARIANTS, type BadgeVariant } from '$lib/design/badge-variants';
	import Banner from '$lib/design/Banner.svelte';
	import { BANNER_TONES } from '$lib/design/banner';
	import Button from '$lib/design/Button.svelte';
	import type { ButtonSize, ButtonVariant } from '$lib/design/button-classes';
	import Checkbox from '$lib/design/Checkbox.svelte';
	import { countryOptions } from '$lib/design/country-picker';
	import {
		queuedDayStatusBadge,
		workUnitStateBadge,
		workUnitStates,
		type WorkUnitStateValue
	} from '$lib/design/day-state-badge';
	import Dialog from '$lib/design/Dialog.svelte';
	import DropZone from '$lib/design/DropZone.svelte';
	import EmptyState from '$lib/design/EmptyState.svelte';
	import ErrorState from '$lib/design/ErrorState.svelte';
	import Field from '$lib/design/Field.svelte';
	import Input from '$lib/design/Input.svelte';
	import KeyboardHint from '$lib/design/KeyboardHint.svelte';
	import Radio from '$lib/design/Radio.svelte';
	import Select from '$lib/design/Select.svelte';
	import SegmentedControl from '$lib/design/SegmentedControl.svelte';
	import Skeleton from '$lib/design/Skeleton.svelte';
	import SourceDocument from '$lib/design/SourceDocument.svelte';
	import type { DocumentProvenanceValue } from '$lib/design/source-document';
	import StatTile from '$lib/design/StatTile.svelte';
	import Table from '$lib/design/Table.svelte';
	import type { TableColumn as DesignTableColumn } from '$lib/design/table';
	import Textarea from '$lib/design/Textarea.svelte';
	import { toasts } from '$lib/design/toast-store.svelte';
	import { resolve } from '$app/paths';
	import { appHref } from '$lib/nav/href';
	import { getLocale } from '$lib/paraglide/runtime';
	import * as m from '$lib/paraglide/messages';
	import { formatMinorUnits } from '$lib/i18n/format';
	import { minorUnits, negateMinorUnits, type MinorUnits, type NotMinorUnits } from '$lib/money';

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

	// ── interface tokens (#208) — the size/spacing itself is always
	// token-driven (`var(--token)` below); only the descriptive role text
	// is this page's own copy, taken verbatim from tokens.css's comments,
	// which stays the single source of the values themselves. ───────────
	const CURRENCY = 'EUR';

	const TYPE_SCALE = [
		{
			token: '--text-2xs',
			value: '0.6875rem',
			px: '11px',
			role: 'axis labels, the smallest legible thing'
		},
		{ token: '--text-xs', value: '0.75rem', px: '12px', role: 'badges, hints, table headers' },
		{ token: '--text-sm', value: '0.8125rem', px: '13px', role: 'secondary text, table cells' },
		{ token: '--text-md', value: '0.9375rem', px: '15px', role: 'body, form controls' },
		{ token: '--text-lg', value: '1.0625rem', px: '17px', role: 'card and section titles' },
		{ token: '--text-xl', value: '1.25rem', px: '20px', role: 'page sections' },
		{ token: '--text-2xl', value: '1.625rem', px: '26px', role: 'page titles' },
		{
			token: '--text-3xl',
			value: '2rem',
			px: '32px',
			role: 'the one figure per screen that matters'
		}
	] as const;

	// Typed rather than `as const`: a heterogeneous literal array makes the
	// member union lack `note` on every entry that omits it, so reading it
	// in the template does not typecheck.
	const SPACE_SCALE: readonly { token: string; value: string; note?: string }[] = [
		{ token: '--space-1', value: '0.25rem (4px)' },
		{ token: '--space-2', value: '0.5rem (8px)' },
		{ token: '--space-3', value: '0.75rem (12px)' },
		{ token: '--space-4', value: '1rem (16px)' },
		{ token: '--space-5', value: '1.5rem (24px)' },
		{ token: '--space-6', value: '2rem (32px)' },
		{ token: '--space-7', value: '3rem (48px)' },
		{ token: '--space-8', value: '4rem (64px)' },
		{ token: '--space-touch', value: '44px', note: 'minimum touch target' }
	];

	const RADIUS_SCALE = [
		{ token: '--radius-sm', value: '6px', role: 'controls, badges, inputs' },
		{ token: '--radius-md', value: '10px', role: 'cards, chart frames, dialogs' },
		{ token: '--radius-full', value: '999px', role: 'pills and count badges' }
	] as const;

	const SHADOW_SCALE = [
		{ token: '--shadow-card', role: 'unused by convention — page-embedded things stay flat' },
		{
			token: '--shadow-overlay',
			role: 'dialogs and toasts — the only elevation the interface uses'
		}
	] as const;

	// ── buttons — four variants, three sizes, plus loading/disabled ──────
	const BUTTON_VARIANTS: readonly ButtonVariant[] = ['primary', 'secondary', 'tertiary', 'danger'];
	const BUTTON_SIZES: readonly ButtonSize[] = ['sm', 'md', 'lg'];

	// ── form controls — every one below reads id/aria-invalid/
	// aria-describedby off an ancestor Field automatically; nothing here
	// spreads those by hand ───────────────────────────────────────────────
	let demoInputValue = $state('Studio Nord Srl');
	let demoTextareaValue = $state('Approved by email, 12 August — see the source document below.');
	let demoSelectValue = $state('IT');
	const selectCountries = $derived(countryOptions(getLocale()));
	let demoCheckboxDefault = $state(true);
	let demoCheckboxRequired = $state(false);
	let demoCheckboxError = $state(false);
	let demoRadioDefault = $state('email');
	let demoRadioRequired = $state('');
	let demoRadioError = $state('');
	const segmentedOptions = [
		{ value: 'full', label: 'Full day' },
		{ value: 'half', label: 'Half day' }
	];
	let demoSegmentedDefault = $state('full');
	let demoSegmentedRequired = $state('full');
	let demoSegmentedError = $state('full');
	let demoSegmentedDisabled = $state('full');
	let demoFilesDefault = $state<FileList | null>(null);
	let demoFilesRequired = $state<FileList | null>(null);
	let demoFilesError = $state<FileList | null>(null);
	let demoFilesDisabled = $state<FileList | null>(null);
	let demoFilesChosen = $state<FileList | null>(null);
	let demoFilesMultiple = $state<FileList | null>(null);
	let demoFilesRejected = $state<FileList | null>(null);
	// The target for a synthetic `drop` below — a real DOM node, not a
	// stand-in, since the point is exercising DropZone's own `ondrop`
	// handler exactly as a browser would.
	let rejectedZoneEl = $state<HTMLDivElement | undefined>(undefined);
	let demoAmountInputDefault = $state('850');
	let demoAmountInputRequired = $state('');
	let demoAmountInputError = $state('12,34,56');
	let demoAmountInputDisabled = $state('850');

	// A real FileList cannot be constructed from a plain object — DataTransfer
	// is the one browser API that produces one outside an actual file picker,
	// client-side only, hence the effect rather than a module-level constant.
	// Demonstrates DropZone's chosen-files list, the one state a picker with
	// nothing selected cannot show.
	$effect(() => {
		if (typeof DataTransfer === 'undefined' || typeof File === 'undefined') return;
		const chosenTransfer = new DataTransfer();
		chosenTransfer.items.add(new File(['date,hours'], 'days-august.csv', { type: 'text/csv' }));
		demoFilesChosen = chosenTransfer.files;

		const multipleTransfer = new DataTransfer();
		multipleTransfer.items.add(new File(['date,hours'], 'days-august.csv', { type: 'text/csv' }));
		multipleTransfer.items.add(
			new File(['date,hours'], 'days-september.csv', { type: 'text/csv' })
		);
		demoFilesMultiple = multipleTransfer.files;
	});

	// The "rejected" state is reachable only by an actual drop — there is no
	// prop that fakes it, since the whole point is that `accept` mismatches
	// are refused by real drag-and-drop handling, not by a flag someone
	// remembered to pass. So this dispatches a real `DragEvent` at the
	// rendered zone once it exists, carrying a wrong-typed file, and lets
	// DropZone's own `ondrop` handler refuse it exactly as it would for a
	// visitor's drag.
	$effect(() => {
		if (
			typeof DataTransfer === 'undefined' ||
			typeof File === 'undefined' ||
			typeof DragEvent === 'undefined' ||
			!rejectedZoneEl
		)
			return;
		const target = rejectedZoneEl.querySelector('.surface');
		if (!target) return;
		const transfer = new DataTransfer();
		transfer.items.add(new File(['not a pdf'], 'notes.docx', { type: 'application/msword' }));
		target.dispatchEvent(
			new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer })
		);
	});

	// ── money — Amount's three sizes, a negative (credit) figure, and the
	// major-unit branch (a rate-card-style price) ────────────────────────
	const moneyFigure = minorUnits(485000);
	const moneyCell = minorUnits(18500);
	const moneyCredit = negateMinorUnits(minorUnits(12000));
	const moneyMajor = 950 as NotMinorUnits;

	// ── badges — the abstract seven-variant vocabulary, plus the eleven
	// concrete day-lifecycle states it renders ────────────────────────────
	const badgeDemoLabel: Record<BadgeVariant, string> = {
		neutral: 'Neutral',
		info: 'Info',
		good: 'Good',
		warning: 'Warning',
		serious: 'Serious',
		critical: 'Critical',
		count: '42'
	};
	const queuedDayStatuses = ['pending', 'syncing', 'failed'] as const;

	// ── data & metrics — invented rows, never real client data ───────────
	interface DemoEngagementRow {
		readonly id: string;
		readonly engagement: string;
		readonly state: WorkUnitStateValue;
		readonly amount: MinorUnits;
	}
	const demoTableRows: readonly DemoEngagementRow[] = [
		{ id: 'eng-1', engagement: 'Studio Nord', state: 'invoiced', amount: minorUnits(185000) },
		{
			id: 'eng-2',
			engagement: 'Ferrovie Est',
			state: 'worked_without_approval',
			amount: minorUnits(42000)
		},
		{ id: 'eng-3', engagement: 'Atelier Blu', state: 'disputed', amount: minorUnits(96500) },
		{ id: 'eng-4', engagement: 'Vento SRL', state: 'paid', amount: minorUnits(310000) }
	];
	const demoTableColumns: readonly DesignTableColumn<DemoEngagementRow>[] = $derived([
		{
			key: 'engagement',
			label: 'Engagement',
			sort: (a: DemoEngagementRow, b: DemoEngagementRow) => a.engagement.localeCompare(b.engagement)
		},
		{ key: 'state', label: 'State', cell: demoStateCell },
		{
			key: 'amount',
			label: 'Amount',
			align: 'end',
			sort: (a: DemoEngagementRow, b: DemoEngagementRow) => a.amount - b.amount,
			cell: demoAmountCell
		}
	]);

	// ── overlays — Dialog kept open by default (see the CSS containing-
	// block trick on `.overlay-stage`), Toast pushed to the real page-wide
	// singleton mounted in the root layout ────────────────────────────────
	let centerDialogOpen = $state(true);
	let sheetDialogOpen = $state(true);
	let demoDialogAmount = $state('');

	// Deliberately not auto-seeded on mount: a persistent (durationMs: null)
	// toast is a fixed-position overlay with no stage containment (unlike
	// Dialog above), so leaving one open by default would drift over
	// whatever section happens to sit at the bottom of a full-page
	// screenshot — the chart primitives section this route must leave
	// untouched. The buttons below still push a real one, auto-dismissing,
	// into the same singleton the root layout renders.

	// ── source documents — a fixed instant, not `Date.now()`: this page's
	// screenshots must stay diffable across passes, not drift with the clock ──
	const demoSourceDocument: {
		id: string;
		originalName: string;
		provenance: DocumentProvenanceValue;
		createdAt: string;
	} = {
		id: 'design-demo-doc',
		originalName: 'approval-email.eml',
		provenance: 'mail',
		createdAt: '2026-08-10T09:15:00.000Z'
	};
</script>

<svelte:head><title>mastro — design system</title></svelte:head>

{#snippet demoStateCell(row: DemoEngagementRow)}
	{@const badge = workUnitStateBadge(row.state)}
	<Badge variant={badge.variant} label={badge.label} size="sm" />
{/snippet}

{#snippet demoAmountCell(row: DemoEngagementRow)}
	<Amount minorUnits={row.amount} currency={CURRENCY} size="md" />
{/snippet}

{#snippet engagementsEmpty()}
	<EmptyState
		icon="▦"
		title={m.day_calendar_empty_state_title()}
		body={m.day_calendar_empty_state()}
	/>
{/snippet}

<Page
	width="wide"
	title="Design system"
	subtitle="Every token, type step, spacing value and shared component in the redesign — every state a real screen puts it in, not only its default — plus the chart colour system and the validator that checks it below. Nothing on this page is real data; it is the regression surface for the redesign (#208)."
>
	{#snippet actions()}
		<div class="theme-toggle" role="group" aria-label="Color scheme">
			{#each ['system', 'light', 'dark'] as const as option (option)}
				<button type="button" class:active={theme === option} onclick={() => setTheme(option)}>
					{option}
				</button>
			{/each}
		</div>
	{/snippet}

	<section>
		<h2>Type scale</h2>
		<p class="lede">
			Seven steps and no more — every font-size in the product resolves to one of these.
		</p>
		<ul class="type-scale">
			{#each TYPE_SCALE as step (step.token)}
				<li>
					<span class="type-sample" style:font-size="var({step.token})"
						>Ledger, with confidence</span
					>
					<span class="type-meta"
						><code>{step.token}</code> · {step.value} · {step.px} — {step.role}</span
					>
				</li>
			{/each}
		</ul>
		<p class="lede">
			Weight above regular: <span style:font-weight="var(--weight-medium)">medium (500)</span> for
			labels and emphasis, <span style:font-weight="var(--weight-bold)">bold (600)</span> for the one
			figure per screen that matters.
		</p>
	</section>

	<section>
		<h2>Spacing &amp; shape</h2>
		<p class="lede">
			A 4px base; <code>--space-touch</code> is the minimum hit area for anything a thumb has to find.
		</p>
		<ul class="space-scale">
			{#each SPACE_SCALE as step (step.token)}
				<li>
					<span class="space-bar" style:width="var({step.token})"></span>
					<code>{step.token}</code>
					<span class="type-meta"
						>{step.value}{#if step.note}
							— {step.note}{/if}</span
					>
				</li>
			{/each}
		</ul>
		<div class="radius-shadow-row">
			{#each RADIUS_SCALE as step (step.token)}
				<div class="radius-sample" style:border-radius="var({step.token})">
					<code>{step.token}</code>
					<span class="type-meta">{step.value} — {step.role}</span>
				</div>
			{/each}
		</div>
		<div class="radius-shadow-row">
			{#each SHADOW_SCALE as step (step.token)}
				<div class="shadow-sample" style:box-shadow="var({step.token})">
					<code>{step.token}</code>
					<span class="type-meta">{step.role}</span>
				</div>
			{/each}
		</div>
	</section>

	<section>
		<h2>Buttons</h2>
		<p class="lede">
			Four variants, three sizes, and the two states — loading, disabled — the 2026-08-13 review
			found drawn inconsistently or not at all. <code>loading</code> never resizes the button: the label
			stays laid out underneath it.
		</p>
		<div class="button-matrix">
			<div></div>
			{#each BUTTON_SIZES as size (size)}
				<div class="button-matrix-head">{size}</div>
			{/each}
			<div class="button-matrix-head">loading</div>
			<div class="button-matrix-head">disabled</div>
			{#each BUTTON_VARIANTS as variant (variant)}
				<div class="button-matrix-row-label">{variant}</div>
				{#each BUTTON_SIZES as size (size)}
					<div class="button-matrix-cell"><Button {variant} {size}>Save</Button></div>
				{/each}
				<div class="button-matrix-cell"><Button {variant} size="md" loading>Save</Button></div>
				<div class="button-matrix-cell"><Button {variant} size="md" disabled>Save</Button></div>
			{/each}
		</div>
		<p class="lede">
			The same variants, rendered as a real <code>&lt;a&gt;</code> via <code>href</code> — same classes,
			same states, reachable by Tab as a link rather than a div.
		</p>
		<div class="button-row">
			{#each BUTTON_VARIANTS as variant (variant)}
				<Button {variant} size="md" href="/design">Link</Button>
			{/each}
		</div>
	</section>

	<section>
		<h2>Form controls</h2>
		<p class="lede">
			Every control below reads its id, <code>aria-invalid</code> and
			<code>aria-describedby</code> off an ancestor <code>Field</code> automatically (field-context.ts)
			— nothing here spreads those by hand. Checkbox and Radio own their id/aria wiring directly instead,
			since their label sits beside the control rather than above it.
		</p>

		<h3>Input</h3>
		<div class="control-grid">
			<div>
				<span class="state-label">Default</span>
				<Field label="Client name"><Input bind:value={demoInputValue} /></Field>
			</div>
			<div>
				<span class="state-label">Required</span>
				<Field label="Client name" required><Input bind:value={demoInputValue} /></Field>
			</div>
			<div>
				<span class="state-label">Error</span>
				<Field label="Client name" error="Enter the client's legal name.">
					<Input bind:value={demoInputValue} />
				</Field>
			</div>
			<div>
				<span class="state-label">Disabled</span>
				<Field label="Client name"><Input bind:value={demoInputValue} disabled /></Field>
			</div>
		</div>

		<h3>Textarea</h3>
		<div class="control-grid">
			<div>
				<span class="state-label">Default</span>
				<Field label="Notes"><Textarea bind:value={demoTextareaValue} rows={3}></Textarea></Field>
			</div>
			<div>
				<span class="state-label">Required</span>
				<Field label="Notes" required
					><Textarea bind:value={demoTextareaValue} rows={3}></Textarea></Field
				>
			</div>
			<div>
				<span class="state-label">Error</span>
				<Field label="Notes" error="Say what happened, in your own words.">
					<Textarea bind:value={demoTextareaValue} rows={3}></Textarea>
				</Field>
			</div>
			<div>
				<span class="state-label">Disabled</span>
				<Field label="Notes"
					><Textarea bind:value={demoTextareaValue} rows={3} disabled></Textarea></Field
				>
			</div>
		</div>

		<h3>Select</h3>
		<div class="control-grid">
			<div>
				<span class="state-label">Default</span>
				<Field label="Country">
					<Select bind:value={demoSelectValue}>
						{#each selectCountries as country (country.code)}
							<option value={country.code}>{country.name}</option>
						{/each}
					</Select>
				</Field>
			</div>
			<div>
				<span class="state-label">Required</span>
				<Field label="Country" required>
					<Select bind:value={demoSelectValue}>
						{#each selectCountries as country (country.code)}
							<option value={country.code}>{country.name}</option>
						{/each}
					</Select>
				</Field>
			</div>
			<div>
				<span class="state-label">Error</span>
				<Field label="Country" error="Choose a country.">
					<Select bind:value={demoSelectValue}>
						{#each selectCountries as country (country.code)}
							<option value={country.code}>{country.name}</option>
						{/each}
					</Select>
				</Field>
			</div>
			<div>
				<span class="state-label">Disabled</span>
				<Field label="Country">
					<Select bind:value={demoSelectValue} disabled>
						{#each selectCountries as country (country.code)}
							<option value={country.code}>{country.name}</option>
						{/each}
					</Select>
				</Field>
			</div>
		</div>

		<h3>Checkbox</h3>
		<div class="control-grid">
			<div>
				<span class="state-label">Default</span>
				<Checkbox label="Send a copy to myself" bind:checked={demoCheckboxDefault} />
			</div>
			<div>
				<span class="state-label">Required</span>
				<Checkbox label="I confirm this is accurate" bind:checked={demoCheckboxRequired} required />
			</div>
			<div>
				<span class="state-label">Error</span>
				<Checkbox
					label="Accept the terms"
					bind:checked={demoCheckboxError}
					error="Required to continue."
				/>
			</div>
			<div>
				<span class="state-label">Disabled</span>
				<Checkbox label="Not available on this plan" checked disabled />
			</div>
		</div>

		<h3>Radio</h3>
		<div class="control-grid">
			<div>
				<span class="state-label">Default</span>
				<Radio
					name="design-radio-default"
					value="email"
					label="Email"
					bind:group={demoRadioDefault}
				/>
			</div>
			<div>
				<span class="state-label">Required</span>
				<Radio
					name="design-radio-required"
					value="email"
					label="Email"
					bind:group={demoRadioRequired}
					required
				/>
			</div>
			<div>
				<span class="state-label">Error</span>
				<Radio
					name="design-radio-error"
					value="email"
					label="Email"
					bind:group={demoRadioError}
					error="Choose a channel."
				/>
			</div>
			<div>
				<span class="state-label">Disabled</span>
				<Radio name="design-radio-disabled" value="email" label="Email" group="email" disabled />
			</div>
		</div>

		<h3>Segmented control</h3>
		<div class="control-grid">
			<div>
				<span class="state-label">Default</span>
				<SegmentedControl
					label="Duration"
					options={segmentedOptions}
					bind:value={demoSegmentedDefault}
				/>
			</div>
			<div>
				<span class="state-label">Required (in a Field)</span>
				<Field label="Duration" required>
					<SegmentedControl
						label="Duration"
						options={segmentedOptions}
						bind:value={demoSegmentedRequired}
					/>
				</Field>
			</div>
			<div>
				<span class="state-label">Error (in a Field)</span>
				<Field label="Duration" error="Choose one.">
					<SegmentedControl
						label="Duration"
						options={segmentedOptions}
						bind:value={demoSegmentedError}
					/>
				</Field>
			</div>
			<div>
				<span class="state-label">Disabled</span>
				<SegmentedControl
					label="Duration"
					options={segmentedOptions}
					bind:value={demoSegmentedDisabled}
					disabled
				/>
			</div>
		</div>

		<h3>Drop zone</h3>
		<div class="control-grid">
			<div>
				<span class="state-label">Default</span>
				<Field label="Import file"><DropZone bind:files={demoFilesDefault} /></Field>
			</div>
			<div>
				<span class="state-label">Required</span>
				<Field label="Import file" required>
					<DropZone bind:files={demoFilesRequired} required />
				</Field>
			</div>
			<div>
				<span class="state-label">Error</span>
				<Field label="Import file" error="Choose a CSV file.">
					<DropZone bind:files={demoFilesError} />
				</Field>
			</div>
			<div>
				<span class="state-label">Disabled</span>
				<Field label="Import file">
					<DropZone bind:files={demoFilesDisabled} disabled />
				</Field>
			</div>
			<div>
				<span class="state-label">Chosen</span>
				<Field label="Import file"><DropZone bind:files={demoFilesChosen} /></Field>
			</div>
			<div>
				<span class="state-label">Multiple, chosen</span>
				<Field label="Days export"><DropZone multiple bind:files={demoFilesMultiple} /></Field>
			</div>
			<div bind:this={rejectedZoneEl}>
				<span class="state-label">Rejected (wrong type dropped)</span>
				<Field label="Contract PDF"
					><DropZone accept=".pdf,application/pdf" bind:files={demoFilesRejected} /></Field
				>
			</div>
		</div>

		<h3>Amount input</h3>
		<div class="control-grid">
			<div>
				<span class="state-label">Default</span>
				<AmountInput label="Day rate" currency={CURRENCY} bind:value={demoAmountInputDefault} />
			</div>
			<div>
				<span class="state-label">Required</span>
				<AmountInput
					label="Day rate"
					currency={CURRENCY}
					bind:value={demoAmountInputRequired}
					required
				/>
			</div>
			<div>
				<span class="state-label">Error</span>
				<AmountInput
					label="Day rate"
					currency={CURRENCY}
					bind:value={demoAmountInputError}
					error="Enter a valid amount."
				/>
			</div>
			<div>
				<span class="state-label">Disabled</span>
				<AmountInput
					label="Day rate"
					currency={CURRENCY}
					bind:value={demoAmountInputDisabled}
					disabled
				/>
			</div>
		</div>
	</section>

	<section>
		<h2>Money</h2>
		<p class="lede">
			Three sizes cover every place a figure appears — <code>figure</code> the one number per screen
			that matters, <code>md</code> a table cell (right-aligned, tabular),
			<code>inline</code> inside a sentence. <code>minorUnits</code>/<code>major</code> are mutually exclusive,
			incompatible branded types: handing this component the wrong one for a given source is a compile
			error, not a figure 100x too small or large on screen.
		</p>
		<div class="money-stage">
			<div>
				<span class="money-label">figure</span>
				<Amount minorUnits={moneyFigure} currency={CURRENCY} size="figure" />
			</div>
			<div>
				<span class="money-label">md — table cell</span>
				<Amount minorUnits={moneyCell} currency={CURRENCY} size="md" />
			</div>
			<div>
				<span class="money-label">md — negative (credit)</span>
				<Amount minorUnits={moneyCredit} currency={CURRENCY} size="md" />
			</div>
			<div>
				<span class="money-label">inline — major units (a rate card price)</span>
				<p class="money-inline-sample">
					Day rate: <Amount major={moneyMajor} currency={CURRENCY} size="inline" /> before tax.
				</p>
			</div>
		</div>
	</section>

	<section>
		<h2>Badges &amp; status</h2>
		<p class="lede">
			One shape/glyph/colour vocabulary for every status chip in the product — colour is never the
			only signal, every variant carries its own glyph too (the chart's own, separate status scale
			is further down, in the validator report).
		</p>
		<h3>Badge vocabulary — every variant, both sizes, plus count</h3>
		<div class="badge-grid">
			{#each BADGE_VARIANTS as variant (variant)}
				{#each BADGE_SIZES as size (size)}
					<Badge {variant} {size} label={badgeDemoLabel[variant]} />
				{/each}
			{/each}
		</div>
		<h3>Day lifecycle — the eleven states a day-recording screen represents</h3>
		<p class="lede">
			Ten <code>work_unit_state</code> values, plus the pre-persistence pseudo state a queued offline
			day passes through before it is ever a database row, split into three below — the day screen, the
			month calendar and alerts all render these identically.
		</p>
		<div class="badge-grid">
			{#each workUnitStates as state (state)}
				{@const badge = workUnitStateBadge(state)}
				<Badge variant={badge.variant} label={badge.label} />
			{/each}
			{#each queuedDayStatuses as status (status)}
				{@const badge = queuedDayStatusBadge(status)}
				<Badge variant={badge.variant} label={badge.label} />
			{/each}
		</div>
	</section>

	<section>
		<h2>Data &amp; metrics</h2>
		<p class="lede">
			One column set drives both a desktop table and a mobile card list at once, both in the DOM,
			CSS picking which shows — resize below 640px, or take the 390px pass, to see the switch. Rows
			here are invented, not client data.
		</p>
		<h3>Table — populated, sortable</h3>
		<Table
			columns={demoTableColumns}
			rows={demoTableRows}
			caption="Illustrative engagements — invented data, for review only"
			rowKey={(row) => row.id}
			empty={engagementsEmpty}
		/>
		<h3>Table — empty state</h3>
		<Table
			columns={demoTableColumns}
			rows={[]}
			caption="Illustrative engagements — empty state"
			rowKey={(row) => row.id}
			empty={engagementsEmpty}
		/>
		<h3>Stat tiles</h3>
		<div class="stat-grid">
			<StatTile label="This week" value="3.5 days" sub="of 5 planned" />
			<StatTile label="Outstanding" value={formatMinorUnits(minorUnits(342500), CURRENCY)} />
			<StatTile
				label="Overdue"
				value={formatMinorUnits(minorUnits(0), CURRENCY)}
				sub="nothing overdue"
			/>
		</div>
	</section>

	<section>
		<h2>Notices</h2>
		<p class="lede">
			An in-context notice — prose plus an optional way forward — distinct from <code>Badge</code>
			(one word inline) and <code>ErrorState</code> (replaces the whole page). Tone never carries the
			meaning alone: every tone pairs its own glyph with its colour.
		</p>
		{#each BANNER_TONES as tone (tone)}
			<div class="banner-row">
				<Banner {tone}>
					{#if tone === 'info'}
						This engagement has no written approval on file yet — a proposal accepted here still
						creates one automatically.
					{:else if tone === 'warning'}
						<strong>No written approval on this contract.</strong> A day recorded as worked without
						one lands in <code>worked_without_approval</code>, not <code>approved</code>.
					{:else}
						<strong>Ceiling exceeded.</strong> This year's revenue against the flat-rate regime has crossed
						its threshold.
					{/if}
					{#snippet actions()}
						<Button variant="secondary" size="sm">Review</Button>
					{/snippet}
				</Banner>
			</div>
		{/each}
	</section>

	<section>
		<h2>Overlays</h2>
		<p class="lede">
			One component for a centred modal and a bottom sheet — <code>placement</code> is the only prop
			that varies. Both render open below, each inside its own scoped stage: a
			<code>transform</code> on the wrapping box becomes the containing block for Dialog's
			<code>position: fixed</code> backdrop (a CSS trick, not a change to Dialog.svelte), so the open
			state stays inside its own frame instead of covering this review page.
		</p>
		<div class="overlay-stage-row">
			<div class="overlay-stage">
				<Dialog bind:open={centerDialogOpen} title="Reject this proposal?" role="alertdialog">
					This cannot be undone. The client keeps the original message on file, and the day stays in
					the proposed queue for a new answer.
					{#snippet actions()}
						<Button variant="secondary" size="sm" onclick={() => (centerDialogOpen = false)}>
							Cancel
						</Button>
						<Button variant="danger" size="sm" onclick={() => (centerDialogOpen = false)}>
							Reject
						</Button>
					{/snippet}
				</Dialog>
				{#if !centerDialogOpen}
					<Button variant="secondary" size="sm" onclick={() => (centerDialogOpen = true)}>
						Reopen — center, alertdialog
					</Button>
				{/if}
			</div>
			<div class="overlay-stage">
				<Dialog bind:open={sheetDialogOpen} title="Log an expense" placement="bottom">
					<AmountInput label="Amount" currency={CURRENCY} bind:value={demoDialogAmount} />
					{#snippet actions()}
						<Button variant="secondary" size="sm" onclick={() => (sheetDialogOpen = false)}>
							Cancel
						</Button>
						<Button variant="primary" size="sm" onclick={() => (sheetDialogOpen = false)}>
							Save
						</Button>
					{/snippet}
				</Dialog>
				{#if !sheetDialogOpen}
					<Button variant="secondary" size="sm" onclick={() => (sheetDialogOpen = true)}>
						Reopen — bottom sheet
					</Button>
				{/if}
			</div>
		</div>

		<h3>Toast</h3>
		<p class="lede">
			A page-wide singleton mounted once in the root layout — every toast below is real, pushed to
			that same store, and renders in its actual fixed position at the bottom of the viewport rather
			than a page-local copy — resting state is empty by default, since a persistent one would drift
			over whatever section sits at the bottom of a full-page screenshot. Each button pushes a real,
			auto-dismissing toast of that tone.
		</p>
		<div class="button-row">
			<Button
				variant="secondary"
				size="sm"
				onclick={() => toasts.push('neutral', 'Draft saved automatically.')}
			>
				Push neutral
			</Button>
			<Button variant="secondary" size="sm" onclick={() => toasts.push('success', 'Invoice sent.')}>
				Push success
			</Button>
			<Button
				variant="secondary"
				size="sm"
				onclick={() => toasts.push('danger', 'Could not save. Try again.')}
			>
				Push danger
			</Button>
		</div>
	</section>

	<section>
		<h2>Loading, empty &amp; error patterns</h2>
		<h3>Skeleton</h3>
		<p class="lede">
			Shape-only, always <code>aria-hidden</code> — the region around it owns the "loading" announcement
			itself.
		</p>
		<div class="skeleton-row">
			<div>
				<span class="state-label">text</span>
				<Skeleton shape="text" lines={3} />
			</div>
			<div>
				<span class="state-label">circle</span>
				<Skeleton shape="circle" />
			</div>
			<div>
				<span class="state-label">block</span>
				<Skeleton shape="block" width="220px" height="80px" />
			</div>
		</div>

		<h3>Empty state — three meanings, one shell</h3>
		<div class="grid-3">
			<EmptyState icon="€" title={m.clients_empty_title()} body={m.clients_empty_body()}>
				{#snippet actions()}
					<a href={resolve('/clients/new')} class="underline">{m.clients_new_link()}</a>
				{/snippet}
			</EmptyState>
			<EmptyState
				icon="✓"
				title={m.invoices_empty_overdue_title()}
				body={m.invoices_empty_overdue_body()}
			/>
			<EmptyState
				icon="▦"
				title={m.day_calendar_empty_state_title()}
				body={m.day_calendar_empty_state()}
			/>
		</div>

		<h3>Error state — warning vs critical</h3>
		<div class="grid-3">
			<ErrorState
				status={400}
				title={m.error_page_title_bad_request()}
				message={m.error_page_body_bad_request()}
			/>
			<ErrorState
				status={404}
				title={m.error_page_title_not_found()}
				message={m.error_page_body_not_found()}
			/>
			<ErrorState
				status={500}
				title={m.error_page_title_server()}
				message={m.error_page_body_server()}
			>
				{#snippet actions()}
					<a href={appHref('/')} class="underline">{m.error_page_home()}</a>
				{/snippet}
			</ErrorState>
		</div>
	</section>

	<section>
		<h2>Keyboard hints</h2>
		<p class="lede">
			A styled <code>&lt;kbd&gt;</code> layered onto a control that already has its own accessible
			name — always <code>aria-hidden</code>, and hidden under <code>(pointer: coarse)</code>. That
			is a real touch device, not merely a narrow window: a 390px-wide desktop browser still reports
			a fine pointer and keeps showing it; only the 390px pass taken under genuine mobile (touch)
			emulation should show it gone.
		</p>
		<div class="button-row">
			<Button variant="primary" size="md">
				New day
				<KeyboardHint>N</KeyboardHint>
			</Button>
			<Button variant="secondary" size="md">
				Save
				<KeyboardHint>Ctrl+Enter</KeyboardHint>
			</Button>
		</div>
	</section>

	<section>
		<h2>Source documents</h2>
		<p class="lede">
			The one place an archived original renders (invariant 4: every derived datum keeps its source
			document). The <code>null</code> branch below is not a skipped empty state — "no source on file"
			is itself information.
		</p>
		<div class="grid-2">
			<div>
				<span class="state-label">On file</span>
				<SourceDocument document={demoSourceDocument} />
			</div>
			<div>
				<span class="state-label">None on file</span>
				<SourceDocument document={null} />
			</div>
		</div>
	</section>
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
</Page>

<style>
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
		grid-template-columns: repeat(auto-fit, minmax(min(20rem, 100%), 1fr));
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

	/* ── interface: type, spacing, shape ────────────────────────────── */
	.type-scale {
		list-style: none;
		margin: 0 0 1rem;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.type-scale li {
		display: flex;
		align-items: baseline;
		gap: var(--space-4);
		flex-wrap: wrap;
		border-bottom: 1px solid var(--border-hairline);
		padding-bottom: var(--space-2);
	}
	.type-sample {
		color: var(--text-primary);
		font-weight: var(--weight-medium);
		min-width: 12rem;
	}
	.type-meta {
		font-size: var(--text-xs);
		color: var(--text-muted);
	}
	.space-scale {
		list-style: none;
		margin: 0 0 1.5rem;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.space-scale li {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}
	.space-bar {
		display: block;
		height: 0.75rem;
		min-width: 2px;
		background: var(--color-primary);
		border-radius: var(--radius-sm);
	}
	.radius-shadow-row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-4);
		margin-bottom: var(--space-4);
	}
	.radius-sample,
	.shadow-sample {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		width: 12rem;
		padding: var(--space-3);
		background: var(--surface-1);
		border: 1px solid var(--line);
	}

	/* ── buttons ─────────────────────────────────────────────────────── */
	.button-matrix {
		display: grid;
		grid-template-columns: max-content repeat(5, minmax(84px, 1fr));
		gap: var(--space-3) var(--space-4);
		align-items: center;
		margin-bottom: var(--space-4);
		/* Five fixed-minimum columns don't fit a 390px viewport — scroll the
		   matrix itself rather than widening the whole page under it.
		   `overflow-x: auto` also flips the grid's own automatic minimum
		   size to 0 (CSS Overflow §"min-size: auto"), so the box actually
		   shrinks to the available width instead of leaking overflow to
		   every ancestor up to <html> (#208 — found on the 390px pass). */
		overflow-x: auto;
		max-width: 100%;
	}
	.button-matrix-head {
		font-size: var(--text-xs);
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.button-matrix-row-label {
		position: sticky;
		left: 0;
		background: var(--surface-1);
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		text-transform: capitalize;
	}
	.button-matrix-cell {
		display: flex;
	}
	.button-row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		margin-bottom: var(--space-4);
	}

	/* ── form controls, badges, metrics, money ──────────────────────────── */
	.control-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: var(--space-4);
		margin: 0 0 var(--space-5);
	}
	.state-label {
		display: block;
		margin-bottom: var(--space-1);
		font-size: var(--text-2xs);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-muted);
	}
	.badge-grid {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-3);
		margin-bottom: var(--space-4);
	}
	.stat-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		gap: var(--space-4);
		margin-bottom: var(--space-4);
	}
	.grid-2 {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
		gap: var(--space-4);
	}
	.grid-3 {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: var(--space-4);
		margin-bottom: var(--space-4);
	}
	.money-stage {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: var(--space-5);
		margin-bottom: var(--space-4);
		align-items: end;
	}
	.money-label {
		display: block;
		margin-bottom: var(--space-1);
		font-size: var(--text-2xs);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-muted);
	}
	.money-inline-sample {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}

	/* ── notices, overlays, loading/empty/error, keyboard hints, docs ───── */
	.banner-row {
		margin-bottom: var(--space-3);
	}
	.overlay-stage-row {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
		gap: var(--space-4);
		margin-bottom: var(--space-4);
	}
	.overlay-stage {
		position: relative;
		min-height: 26rem;
		padding: var(--space-3);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: var(--surface-2);
		/* A `transform` on this ancestor becomes the containing block for
		   Dialog's `position: fixed` backdrop — the demo stays inside its own
		   box instead of covering the whole review page, with no change to
		   Dialog.svelte itself. */
		transform: translateZ(0);
		overflow: hidden;
	}
	.skeleton-row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-5);
		margin-bottom: var(--space-4);
		align-items: flex-start;
	}
	.skeleton-row > div {
		min-width: 12rem;
	}
</style>
