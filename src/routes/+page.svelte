<!--
	The home screen (#234): an attention queue, not the product's name and
	a tagline. Three sections, in the order the mockup (10-dashboard.html,
	direction B2) draws them: "Da sistemare" (what needs a decision today
	— days at risk, invoices overdue, ceilings approaching, proposals
	pending, each with its resolving action), "Questa settimana" (the
	current backlog, glanceable), "Soldi" (what is owed, and the one
	ceiling that matters right now). The cash calendar and client
	concentration charts moved to `/reports` — see that route's own header
	comment for why a separate page rather than a lower section on this
	one.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { getLocale } from '$lib/paraglide/runtime';
	import * as m from '$lib/paraglide/messages';
	import {
		formatDate,
		formatFullDate,
		formatMinorUnits,
		formatMonth,
		formatWeekday,
		formatWeekRange
	} from '$lib/i18n/format';
	import Badge from '$lib/design/Badge.svelte';
	import Button from '$lib/design/Button.svelte';
	import KeyboardHint from '$lib/design/KeyboardHint.svelte';
	import StatTile from '$lib/design/StatTile.svelte';
	import { dashboardInvoiceStatus } from '$lib/dashboard/invoice-status';
	import { pendingProposalsSummary } from '$lib/dashboard/proposals-summary';
	import AttentionQueue from '$lib/dashboard/AttentionQueue.svelte';
	import CeilingMeter from '$lib/dashboard/CeilingMeter.svelte';
	import Page from '$lib/layout/Page.svelte';
	import Section from '$lib/layout/Section.svelte';
	import type { PageProps } from './$types';
	import { appHref } from '$lib/nav/href';

	let { data }: PageProps = $props();

	const locale = $derived(getLocale());
	const todayLabel = $derived(formatFullDate(data.today));
	const monthLabel = $derived(formatMonth(data.today));

	// #24: "n" jumps straight into the entry form from the home screen,
	// skipping even the one tap. Ignored while typing anywhere else on
	// the page, so it never steals a literal "n" from a text field.
	function onKeydown(event: KeyboardEvent) {
		const target = event.target as HTMLElement | null;
		const typing =
			target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;
		if (!typing && event.key === 'n' && !event.ctrlKey && !event.metaKey && !event.altKey) {
			event.preventDefault();
			goto(resolve('/day/new'));
		}
	}

	const weekRangeLabel = $derived(formatWeekRange(data.week.dates[0], data.week.dates[6]));
	const weekdayLabels = $derived(data.week.dates.map((date) => formatWeekday(date)));
	const weekHasEntries = $derived(data.week.entryDates.length > 0);

	function joinDates(dates: readonly string[]): string {
		return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(
			dates.map((date) => formatDate(date))
		);
	}

	const proposedStatDays = $derived(
		data.week.pendingProposalDays.reduce((sum, day) => sum + day.quantity, 0)
	);

	// The section badge takes the queue's own worst row, never a flat
	// "critical" that would mislead when the queue is entirely warnings
	// or only the info-level proposals row.
	function worstAttentionSeverity(
		rows: readonly { severity: 'critical' | 'serious' | 'warning' | 'info' }[]
	): 'critical' | 'serious' | 'warning' | 'info' {
		if (rows.some((row) => row.severity === 'critical')) return 'critical';
		if (rows.some((row) => row.severity === 'serious')) return 'serious';
		if (rows.some((row) => row.severity === 'warning')) return 'warning';
		return 'info';
	}
	const attentionBadgeVariant = $derived(worstAttentionSeverity(data.attentionRows));

	// The reports page carries both charts; each link lands on its own
	// section. Built here rather than inline so the href is a single
	// resolved value, which is what the navigation lint rule asks for.
	const concentrationHref = appHref('/reports') + '#concentrazione-clienti';
	const cashCalendarHref = appHref('/reports') + '#cassa-per-mese';
</script>

<svelte:window onkeydown={onKeydown} />

<svelte:head><title>{m.dashboard_today_heading()} — mastro</title></svelte:head>

<Page title={m.dashboard_today_heading()} subtitle={todayLabel} width="wide">
	{#snippet actions()}
		<!--
			Below 900px the bottom bar's floating "+" already goes to
			`/day/new` (`nav/BottomBar.svelte`), and the sidebar is hidden at
			exactly that width (`+layout.svelte`), so this button is the same
			action a thumb's-reach away from itself (#366). Hidden there rather
			than removed: above 900px there is no FAB, and the keyboard hint
			belongs to a keyboard.
		-->
		<span class="wide-only">
			<Button href={resolve('/day/new')} variant="primary">
				{m.home_record_day_cta()}
				<KeyboardHint>N</KeyboardHint>
			</Button>
		</span>
		{#if data.pendingProposalsCount > 0}
			<Button href={resolve('/proposals')} variant="secondary">
				{m.dashboard_review_proposals_cta({ count: data.pendingProposalsCount })}
			</Button>
		{/if}
	{/snippet}

	<Section title={m.dashboard_attention_heading()}>
		{#snippet actions()}
			{#if data.attentionRows.length > 0}
				<Badge
					variant={attentionBadgeVariant}
					size="sm"
					label={m.dashboard_attention_count({ count: data.attentionRows.length })}
				/>
			{/if}
		{/snippet}
		<AttentionQueue rows={data.attentionRows} />
	</Section>

	<Section title={m.dashboard_week_heading()}>
		{#snippet actions()}
			<span class="week-range">{weekRangeLabel}</span>
		{/snippet}
		<div class="week-card">
			<div class="stat-grid">
				<StatTile
					label={m.dashboard_week_stat_approved_label()}
					value={String(data.week.approvedAwaitingWork.count)}
					sub={data.week.approvedAwaitingWork.count > 0
						? joinDates(data.week.approvedAwaitingWork.sampleDates)
						: m.dashboard_week_stat_none_yet()}
				/>
				<StatTile
					label={m.dashboard_week_stat_proposed_label()}
					value={new Intl.NumberFormat(locale).format(proposedStatDays)}
					sub={data.week.pendingProposalDays.length > 0
						? pendingProposalsSummary(data.week.pendingProposalDays, locale)
						: m.dashboard_week_stat_none_yet()}
				/>
				<StatTile
					label={m.dashboard_week_stat_worked_label({ month: monthLabel })}
					value={String(data.week.workedThisMonth.count)}
					sub={data.week.workedThisMonth.count === 0 ? m.dashboard_week_stat_none_yet() : undefined}
				/>
				<StatTile
					label={m.dashboard_week_stat_value_label({ month: monthLabel })}
					value={formatMinorUnits(data.week.workedThisMonth.valueMinorUnits, 'EUR')}
					sub={data.week.approvedAwaitingWork.valueMinorUnits > 0
						? m.dashboard_week_stat_value_if_confirmed({
								amount: formatMinorUnits(data.week.approvedAwaitingWork.valueMinorUnits, 'EUR')
							})
						: undefined}
				/>
			</div>
			<div class="week-cal-wrap">
				<span class="sr-only">
					{weekHasEntries
						? m.dashboard_week_calendar_summary({ range: weekRangeLabel })
						: m.dashboard_week_calendar_summary_empty({ range: weekRangeLabel })}
				</span>
				<div class="week-cal" aria-hidden="true">
					{#each weekdayLabels as label, index (index)}
						<div class="cal-head">{label}</div>
					{/each}
					{#each data.week.dates as date (date)}
						<div class="cal-cell" class:today={date === data.today}>
							<span class="cal-date">{Number(date.slice(8, 10))}</span>
							{#if data.week.entryDates.includes(date)}
								<span class="cal-dot"></span>
							{/if}
						</div>
					{/each}
				</div>
			</div>
			{#if !weekHasEntries}
				<p class="week-empty-note">{m.dashboard_week_empty_note()}</p>
			{/if}
		</div>
	</Section>

	<Section title={m.dashboard_money_heading()}>
		<div class="money-grid">
			<div class="card">
				<div class="card-head">
					<h3>{m.dashboard_money_receivable_heading()}</h3>
					{#if data.money.overdueCount > 0}
						<Badge
							variant="critical"
							size="sm"
							label={m.dashboard_money_overdue_badge({ count: data.money.overdueCount })}
						/>
					{/if}
				</div>
				<div class="card-body">
					<span class="fig">{formatMinorUnits(data.money.totalOutstanding, 'EUR')}</span>
					{#if data.money.invoices.length === 0}
						<p class="money-empty">{m.dashboard_money_receivable_empty()}</p>
					{:else}
						<ul class="invoice-rows">
							{#each data.money.invoices as invoice (invoice.id)}
								{@const status = dashboardInvoiceStatus(invoice.daysLate)}
								<li class="invoice-row">
									<div class="invoice-main">
										<a class="invoice-number" href={appHref(`/invoices/${invoice.id}`)}>
											{invoice.number}
										</a>
										<span class="invoice-client">{invoice.clientLegalName}</span>
										<Badge variant={status.level} size="sm" label={status.label} />
									</div>
									<span class="invoice-amount">
										{formatMinorUnits(invoice.total, invoice.currency)}
									</span>
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			</div>

			{#if data.money.ceiling}
				<CeilingMeter view={data.money.ceiling} />
			{/if}
		</div>
	</Section>

	<Section title={m.dashboard_reports_heading()}>
		<p class="reports-links">
			<!-- Both hrefs are `resolve('/reports')` with a fragment appended, built
			     in the script above. The rule only recognises a literal `resolve()`
			     call in the attribute and cannot express "a resolved path plus an
			     anchor", which is what a link to a section of another page is. -->
			<!-- eslint-disable svelte/no-navigation-without-resolve -->
			<a href={concentrationHref}>
				{m.dashboard_concentration_heading()}
			</a>
			<span aria-hidden="true"> · </span>
			<a href={cashCalendarHref}>{m.dashboard_cash_calendar_heading()}</a>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		</p>
	</Section>
</Page>

<style>
	.week-range {
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}
	.week-card {
		background: var(--surface-1);
		border: 1px solid var(--border-hairline);
		border-radius: var(--radius-md);
		padding: var(--space-4);
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.stat-grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: var(--space-4);
	}
	.week-cal-wrap {
		overflow-x: auto;
	}
	.week-cal {
		display: grid;
		grid-template-columns: repeat(7, minmax(2.25rem, 1fr));
		gap: 2px;
	}
	.cal-head {
		text-align: center;
		font-size: var(--text-2xs);
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.03em;
		padding-bottom: var(--space-1);
	}
	.cal-cell {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		height: 2.5rem;
		border-radius: var(--radius-sm);
		background: var(--surface-2);
		font-size: var(--text-sm);
		font-variant-numeric: tabular-nums;
		color: var(--text-secondary);
	}
	.cal-cell.today {
		background: var(--color-primary);
		color: var(--color-primary-ink);
		font-weight: var(--weight-bold);
	}
	.cal-dot {
		position: absolute;
		bottom: 4px;
		width: 4px;
		height: 4px;
		border-radius: 50%;
		background: currentColor;
	}
	.week-empty-note {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-muted);
	}
	.money-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
		gap: var(--space-4);
	}
	.card {
		background: var(--surface-1);
		border: 1px solid var(--border-hairline);
		border-radius: var(--radius-md);
		padding: var(--space-4);
	}
	.card-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		margin-bottom: var(--space-3);
	}
	.card-head h3 {
		margin: 0;
		font-size: var(--text-lg);
		font-weight: var(--weight-bold);
		color: var(--text-primary);
	}
	.card-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.fig {
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		font-size: var(--text-3xl);
		font-weight: var(--weight-bold);
		color: var(--text-primary);
		line-height: 1.1;
	}
	.money-empty {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-muted);
	}
	.invoice-rows {
		margin: 0 calc(var(--space-4) * -1) calc(var(--space-4) * -1);
		padding: 0;
		list-style: none;
		border-top: 1px solid var(--border-hairline);
	}
	.invoice-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		border-bottom: 1px solid var(--border-hairline);
	}
	.invoice-row:last-child {
		border-bottom: none;
	}
	.invoice-main {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
	}
	.invoice-number {
		font-family: var(--font-mono);
		color: var(--text-primary);
		text-decoration: underline;
	}
	.invoice-client {
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}
	.invoice-amount {
		flex: none;
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		font-size: var(--text-md);
		font-weight: var(--weight-medium);
		color: var(--text-primary);
	}
	.reports-links {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-muted);
	}
	.reports-links a {
		color: var(--text-secondary);
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

	@media (max-width: 639px) {
		.stat-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	/* 900px is the shell's own switch: the sidebar appears and the bottom
	   bar with its "+" disappears at exactly this width
	   (`routes/+layout.svelte`). Keep the two in step. */
	@media (max-width: 899px) {
		.wide-only {
			display: none;
		}
	}
</style>
