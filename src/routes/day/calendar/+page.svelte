<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import {
		formatAmount,
		formatDate,
		formatDays,
		formatMonth,
		formatWeekday
	} from '$lib/i18n/format';
	import ChartFrame from '$lib/design/charts/ChartFrame.svelte';
	import PageHeader from '$lib/nav/PageHeader.svelte';
	import type { TableColumn } from '$lib/design/charts/types';
	import DayStateBadge from '../DayStateBadge.svelte';
	import { mostAttentionNeedingState, workUnitStateLabel } from '../work-unit-state';
	import { buildMonthGrid, shiftMonth } from './month-grid';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const weeks = $derived(buildMonthGrid(data.monthStart));
	// Any week has one cell per weekday in order — the header row reads its
	// labels off the first week rather than a second, separately maintained
	// list that could drift from the grid's own Monday-first order.
	const weekdayDates = $derived(weeks[0]?.map((cell) => cell.date) ?? []);

	type EntryRow = {
		date: string;
		contract: string;
		state: string;
		quantity: string;
		amount: string;
	};

	const entryColumns: readonly TableColumn<EntryRow>[] = [
		{ key: 'date', label: m.day_calendar_column_date() },
		{ key: 'contract', label: m.day_calendar_column_contract() },
		{ key: 'state', label: m.day_calendar_column_state() },
		{ key: 'quantity', label: m.day_calendar_column_quantity(), align: 'end' },
		{ key: 'amount', label: m.day_calendar_column_amount(), align: 'end' }
	];

	const entryRows: EntryRow[] = $derived(
		[...data.entries]
			.sort((a, b) => a.date.localeCompare(b.date))
			.map((entry) => ({
				date: formatDate(entry.date),
				contract: entry.contractLabel,
				state: workUnitStateLabel(entry.state),
				quantity: String(entry.quantity),
				amount:
					entry.amount !== null && entry.currency
						? formatAmount(entry.amount, entry.currency)
						: m.day_calendar_amount_unpriced()
			}))
	);
</script>

<svelte:head
	><title>{m.day_calendar_page_title({ month: formatMonth(data.monthStart) })}</title></svelte:head
>

<main class="mx-auto max-w-3xl p-4 sm:p-8">
	<PageHeader title={m.day_calendar_heading({ month: formatMonth(data.monthStart) })}>
		{#snippet actions()}
			<nav
				class="flex items-center gap-3 text-sm"
				aria-label={m.day_calendar_heading({ month: formatMonth(data.monthStart) })}
			>
				<a
					href={resolve(`/day/calendar?month=${shiftMonth(data.monthStart, -1).slice(0, 7)}`)}
					class="underline"
				>
					{m.day_calendar_prev_month()}
				</a>
				<a href={resolve('/day/calendar')} class="underline">{m.day_calendar_today_link()}</a>
				<a
					href={resolve(`/day/calendar?month=${shiftMonth(data.monthStart, 1).slice(0, 7)}`)}
					class="underline"
				>
					{m.day_calendar_next_month()}
				</a>
			</nav>
		{/snippet}
	</PageHeader>

	<p class="mt-4 flex flex-wrap gap-6 text-sm">
		<span
			><span class="opacity-70">{m.day_calendar_total_days_label()}:</span>
			{formatDays(data.totalDays)}</span
		>
		{#if data.totalsByCurrency.size > 0}
			<span>
				<span class="opacity-70">{m.day_calendar_total_amount_label()}:</span>
				{#each [...data.totalsByCurrency] as [currency, amount] (currency)}
					{formatAmount(amount, currency)}
				{/each}
			</span>
		{/if}
	</p>

	<div class="mt-6">
		<ChartFrame
			title={formatMonth(data.monthStart)}
			caption={m.day_calendar_table_caption({ month: formatMonth(data.monthStart) })}
			columns={entryColumns}
			rows={entryRows}
		>
			{#snippet chart()}
				<table class="calendar-grid">
					<caption class="sr-only">
						{m.day_calendar_table_caption({ month: formatMonth(data.monthStart) })}
					</caption>
					<thead>
						<tr>
							{#each weekdayDates as date (date)}
								<th scope="col">{formatWeekday(date)}</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each weeks as week, weekIndex (weekIndex)}
							<tr>
								{#each week as cell (cell.date)}
									{@const cellEntries = data.entriesByDate.get(cell.date) ?? []}
									{@const dayNumber = Number(cell.date.slice(-2))}
									<td class:padding={!cell.inMonth}>
										{#if !cell.inMonth}
											<span class="day-number muted">{dayNumber}</span>
										{:else if cellEntries.length === 0}
											<a
												href={resolve(`/day/new?date=${cell.date}`)}
												class="day-cell"
												aria-label={m.day_calendar_new_entry_for_date({
													date: formatDate(cell.date)
												})}
											>
												<span class="day-number">{dayNumber}</span>
											</a>
										{:else}
											{@const primaryState = mostAttentionNeedingState(
												cellEntries.map((e) => e.state)
											)}
											<a
												href={cellEntries.length === 1
													? resolve('/day/[id]', { id: cellEntries[0].id })
													: resolve('/day/date/[date]', { date: cell.date })}
												class="day-cell"
												aria-label={m.day_calendar_open_date({
													date: formatDate(cell.date),
													label: workUnitStateLabel(primaryState)
												})}
											>
												<span class="day-number">{dayNumber}</span>
												<DayStateBadge state={primaryState} compact />
												{#if cellEntries.length > 1}
													<span class="more"
														>{m.day_calendar_more_entries({ count: cellEntries.length - 1 })}</span
													>
												{/if}
											</a>
										{/if}
									</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			{/snippet}
		</ChartFrame>
	</div>

	{#if data.entries.length === 0}
		<p class="mt-4 text-sm opacity-70">{m.day_calendar_empty_state()}</p>
	{/if}
</main>

<style>
	.calendar-grid {
		width: 100%;
		border-collapse: collapse;
		table-layout: fixed;
	}
	.calendar-grid th {
		padding: 0.375rem;
		color: var(--text-secondary);
		font-size: 0.75rem;
		font-weight: 600;
		text-align: center;
	}
	.calendar-grid td {
		border: 1px solid var(--grid-line);
		padding: 0;
		height: 4.5rem;
		vertical-align: top;
	}
	.calendar-grid td.padding {
		background: var(--surface-page);
	}
	.day-cell {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		width: 100%;
		height: 100%;
		padding: 0.375rem;
		color: inherit;
		text-decoration: none;
		/* Large touch target: the whole cell is tappable, not just the number. */
	}
	.day-cell:hover,
	.day-cell:focus-visible {
		background: var(--surface-1);
		outline: 2px solid var(--certainty-projected);
		outline-offset: -2px;
	}
	.day-number {
		font-size: 0.8125rem;
		font-variant-numeric: tabular-nums;
		color: var(--text-primary);
	}
	.day-number.muted {
		display: block;
		padding: 0.375rem;
		color: var(--text-muted);
	}
	.more {
		font-size: 0.6875rem;
		color: var(--text-secondary);
	}
</style>
