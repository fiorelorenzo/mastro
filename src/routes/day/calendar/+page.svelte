<script lang="ts">
	// The month calendar (#25, redesigned for #221): the primary monthly
	// instrument a day biller has, so it gets its own two renderings instead
	// of borrowing `ChartFrame`'s chart/table toggle — a calendar is not a
	// chart, and that toggle collapsed the whole grid into a flat table
	// below 640px, disappearing on exactly the device this product's
	// audience reaches for first. Desktop gets the month grid (cells never
	// under 74px, state/quantity/value per day, an add affordance per
	// cell); a phone gets a dense agenda of only the weeks that actually
	// have something in them, not a table dump of every empty day.
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import {
		formatAmount,
		formatDate,
		formatDays,
		formatMonth,
		formatNumber,
		formatWeekRange,
		formatWeekday
	} from '$lib/i18n/format';
	import Amount from '$lib/design/Amount.svelte';
	import Badge from '$lib/design/Badge.svelte';
	import Button from '$lib/design/Button.svelte';
	import EmptyState from '$lib/design/EmptyState.svelte';
	import { workUnitStateBadge } from '$lib/design/day-state-badge';
	import Page from '$lib/layout/Page.svelte';
	import { buildCalendarCells, summarizeMonth, weeksWithEntries } from './calendar-cells';
	import { buildMonthGrid, shiftMonth } from './month-grid';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const weeks = $derived(buildMonthGrid(data.monthStart));
	// Any week has one cell per weekday in order — the header row reads its
	// labels off the first week rather than a second, separately maintained
	// list that could drift from the grid's own Monday-first order.
	const weekdayDates = $derived(weeks[0]?.map((cell) => cell.date) ?? []);
	const cellWeeks = $derived(buildCalendarCells(weeks, data.entriesByDate));
	const agendaWeeks = $derived(weeksWithEntries(cellWeeks));
	const totals = $derived(summarizeMonth(data.entries));

	const todayIso = new Date().toISOString().slice(0, 10);
	const monthLabel = $derived(formatMonth(data.monthStart));
	const prevMonthHref = $derived(
		`/day/calendar?month=${shiftMonth(data.monthStart, -1).slice(0, 7)}`
	);
	const nextMonthHref = $derived(
		`/day/calendar?month=${shiftMonth(data.monthStart, 1).slice(0, 7)}`
	);
</script>

<svelte:head><title>{m.day_calendar_page_title({ month: monthLabel })}</title></svelte:head>

<Page title={m.day_calendar_heading({ month: monthLabel })} width="wide">
	{#snippet actions()}
		<nav class="month-nav" aria-label={m.day_calendar_heading({ month: monthLabel })}>
			<Button variant="tertiary" size="sm" href={prevMonthHref}>
				{m.day_calendar_prev_month()}
			</Button>
			<Button variant="tertiary" size="sm" href="/day/calendar">
				{m.day_calendar_today_link()}
			</Button>
			<Button variant="tertiary" size="sm" href={nextMonthHref}>
				{m.day_calendar_next_month()}
			</Button>
		</nav>
	{/snippet}

	<!-- The stats' own accessible name carries the month (#221's copy fix:
	     the old "Giornate lavorate: 0 giorni" summary never said which
	     period the count belonged to) — the visible labels below stay short
	     because they already sit right under the month heading. -->
	<div
		class="stats"
		role="group"
		aria-label={m.day_calendar_totals_group_label({ month: monthLabel })}
	>
		<div class="stat">
			<span class="stat-label">{m.day_calendar_stat_approved()}</span>
			<span class="stat-value">{formatDays(totals.approvedDays)}</span>
		</div>
		<div class="stat">
			<span class="stat-label">{m.day_calendar_stat_proposed()}</span>
			<span class="stat-value">{formatDays(totals.proposedDays)}</span>
		</div>
		<div class="stat">
			<span class="stat-label">{m.day_calendar_stat_worked()}</span>
			<span class="stat-value">{formatDays(totals.workedDays)}</span>
		</div>
		<div class="stat">
			<span class="stat-label">{m.day_calendar_stat_value()}</span>
			<span class="stat-value">
				{#if totals.valueByCurrency.size === 0}
					{m.day_calendar_amount_unpriced()}
				{:else}
					{#each [...totals.valueByCurrency] as [currency, amount] (currency)}
						{formatAmount(amount, currency)}
					{/each}
				{/if}
			</span>
		</div>
	</div>

	<div class="calendar-desktop">
		<table class="calendar-grid">
			<caption class="sr-only">{m.day_calendar_grid_caption({ month: monthLabel })}</caption>
			<thead>
				<tr>
					{#each weekdayDates as date (date)}
						<th scope="col">{formatWeekday(date)}</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each cellWeeks as week, weekIndex (weekIndex)}
					<tr>
						{#each week as cell (cell.date)}
							{@const dayNumber = Number(cell.date.slice(-2))}
							<td class:padding={!cell.inMonth} class:today={cell.date === todayIso}>
								{#if !cell.inMonth}
									<span class="day-number muted">{dayNumber}</span>
								{:else if cell.entries.length === 0}
									<a
										href={resolve(`/day/new?date=${cell.date}`)}
										class="cell-link cell-empty"
										aria-label={m.day_calendar_new_entry_for_date({ date: formatDate(cell.date) })}
									>
										<span class="day-number">{dayNumber}</span>
									</a>
								{:else}
									{@const primaryState = cell.primaryState!}
									{@const primaryEntry =
										cell.entries.find((entry) => entry.state === primaryState) ?? cell.entries[0]}
									<div class="cell-occupied">
										<a
											href={resolve('/day/[id=uuid]', { id: primaryEntry.id })}
											class="cell-link"
											aria-label={m.day_calendar_open_date({
												date: formatDate(cell.date),
												label: workUnitStateBadge(primaryState).label
											})}
										>
											<span class="day-number">{dayNumber}</span>
											<Badge
												variant={workUnitStateBadge(primaryState).variant}
												label={workUnitStateBadge(primaryState).label}
												size="sm"
											/>
											<span class="cell-quantity">{formatNumber(cell.quantity)}</span>
											{#if cell.valueByCurrency.size === 0}
												<span class="cell-quantity">{m.day_calendar_amount_unpriced()}</span>
											{:else}
												{#each [...cell.valueByCurrency] as [currency, amount] (currency)}
													<Amount major={amount} {currency} size="inline" />
												{/each}
											{/if}
											{#if cell.entries.length > 1}
												<span class="more"
													>{m.day_calendar_more_entries({ count: cell.entries.length - 1 })}</span
												>
											{/if}
										</a>
										<a
											href={resolve(`/day/new?date=${cell.date}`)}
											class="cell-add"
											aria-label={m.day_calendar_new_entry_for_date({
												date: formatDate(cell.date)
											})}
										>
											+
										</a>
									</div>
								{/if}
							</td>
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	<div class="calendar-phone">
		{#each agendaWeeks as week (week[0].date)}
			{@const headingId = `agenda-week-${week[0].date}`}
			<section class="agenda-week">
				<h3 id={headingId}>{formatWeekRange(week[0].date, week[6].date)}</h3>
				<ul class="agenda-rows" aria-labelledby={headingId}>
					{#each week as cell (cell.date)}
						{#each cell.entries as entry (entry.id)}
							{@const badge = workUnitStateBadge(entry.state)}
							<li class="agenda-row">
								<a href={resolve('/day/[id=uuid]', { id: entry.id })} class="agenda-link">
									<span class="agenda-date">{cell.date.slice(-2)}</span>
									<span class="agenda-main">
										<span class="agenda-title">{entry.contractLabel}</span>
										<span class="agenda-meta">{formatNumber(entry.quantity)}</span>
									</span>
									<span class="agenda-end">
										<Badge variant={badge.variant} label={badge.label} size="sm" />
										{#if entry.amount !== null && entry.currency}
											<Amount major={entry.amount} currency={entry.currency} size="inline" />
										{:else}
											<span class="unpriced">{m.day_calendar_amount_unpriced()}</span>
										{/if}
									</span>
								</a>
							</li>
						{/each}
					{/each}
				</ul>
			</section>
		{/each}
	</div>

	{#if data.entries.length === 0}
		<EmptyState
			icon="▦"
			title={m.day_calendar_empty_state_title()}
			body={m.day_calendar_empty_state()}
		/>
	{/if}
</Page>

<style>
	.month-nav {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.stats {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-5);
		margin-top: var(--space-4);
	}
	.stat {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}
	.stat-label {
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}
	.stat-value {
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		font-size: var(--text-md);
		font-weight: var(--weight-medium);
		color: var(--text-primary);
	}

	.calendar-desktop {
		margin-top: var(--space-5);
	}
	.calendar-phone {
		display: none;
		margin-top: var(--space-5);
		flex-direction: column;
		gap: var(--space-5);
	}

	.calendar-grid {
		width: 100%;
		border-collapse: collapse;
		table-layout: fixed;
	}
	.calendar-grid th {
		padding: var(--space-2);
		color: var(--text-secondary);
		font-size: var(--text-xs);
		font-weight: 600;
		text-align: center;
	}
	.calendar-grid td {
		border: 1px solid var(--grid-line);
		padding: 0;
		min-height: 74px;
		vertical-align: top;
	}
	.calendar-grid td.padding {
		background: var(--surface-page);
	}
	.calendar-grid td.today {
		box-shadow: inset 0 0 0 2px var(--certainty-projected);
	}

	.day-number {
		display: block;
		padding: var(--space-2);
		font-size: var(--text-sm);
		font-variant-numeric: tabular-nums;
		color: var(--text-primary);
	}
	.day-number.muted {
		color: var(--text-muted);
	}

	.cell-empty,
	.cell-occupied {
		display: block;
		height: 100%;
		min-height: 74px;
		position: relative;
	}
	.cell-link {
		display: flex;
		flex-direction: column;
		gap: 0.1875rem;
		width: 100%;
		height: 100%;
		padding-bottom: var(--space-4);
		color: inherit;
		text-decoration: none;
		/* Large touch target: everything but the corner "+" is tappable. */
	}
	.cell-link:hover,
	.cell-link:focus-visible {
		background: var(--surface-1);
		outline: 2px solid var(--certainty-projected);
		outline-offset: -2px;
	}
	.cell-quantity {
		padding: 0 var(--space-2);
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
		color: var(--text-secondary);
	}
	.cell-link :global(.amount) {
		padding: 0 var(--space-2);
		font-size: var(--text-xs);
	}
	.more {
		padding: 0 var(--space-2);
		font-size: var(--text-2xs);
		color: var(--text-secondary);
	}
	.cell-add {
		position: absolute;
		right: 0.25rem;
		bottom: 0.25rem;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.25rem;
		height: 1.25rem;
		border-radius: var(--radius-full);
		background: var(--surface-2);
		color: var(--text-secondary);
		font-size: var(--text-sm);
		line-height: 1;
		text-decoration: none;
	}
	.cell-add:hover,
	.cell-add:focus-visible {
		background: var(--color-primary);
		color: var(--color-primary-ink);
	}

	.agenda-week h3 {
		margin: 0 0 var(--space-2);
		font-size: var(--text-sm);
		font-weight: 600;
		color: var(--text-secondary);
	}
	.agenda-rows {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.agenda-link {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3);
		border: 1px solid var(--border-hairline);
		border-radius: var(--radius-md);
		color: inherit;
		text-decoration: none;
	}
	.agenda-link:hover,
	.agenda-link:focus-visible {
		background: var(--surface-1);
		outline: 2px solid var(--certainty-projected);
		outline-offset: -2px;
	}
	.agenda-date {
		flex: none;
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		font-size: var(--text-lg);
		color: var(--text-secondary);
	}
	.agenda-main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}
	.agenda-title {
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		color: var(--text-primary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.agenda-meta {
		font-size: var(--text-xs);
		color: var(--text-secondary);
	}
	.agenda-end {
		flex: none;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.1875rem;
	}
	.unpriced {
		font-size: var(--text-xs);
		color: var(--text-muted);
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

	@media (max-width: 640px) {
		.calendar-desktop {
			display: none;
		}
		.calendar-phone {
			display: flex;
		}
	}
</style>
