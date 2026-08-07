<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import { formatAmount, formatDate, formatDateTime, formatNumber } from '$lib/i18n/format';
	import DataTable from '$lib/design/charts/DataTable.svelte';
	import type { TableColumn } from '$lib/design/charts/types';
	import DayStateBadge from '../DayStateBadge.svelte';
	import { workUnitStateLabel, type WorkUnitStateValue } from '../work-unit-state';
	import type { ActionData, PageProps } from './$types';

	let { data, form }: PageProps & { form: ActionData } = $props();

	function actorLabel(actor: { kind: string; email?: string; proposalReference?: string }): string {
		if (actor.kind === 'human') return actor.email ?? '';
		if (actor.kind === 'agent') {
			return m.day_detail_actor_agent({ reference: actor.proposalReference ?? '' });
		}
		return m.day_detail_actor_system();
	}

	function changeLabel(transition: {
		fromState: WorkUnitStateValue | null;
		toState: WorkUnitStateValue;
	}): string {
		return transition.fromState
			? m.day_detail_history_change({
					from: workUnitStateLabel(transition.fromState),
					to: workUnitStateLabel(transition.toState)
				})
			: m.day_detail_history_change_initial({ to: workUnitStateLabel(transition.toState) });
	}

	type HistoryRow = { when: string; change: string; reason: string; actor: string };

	const historyColumns: readonly TableColumn<HistoryRow>[] = [
		{ key: 'when', label: m.day_detail_history_column_when() },
		{ key: 'change', label: m.day_detail_history_column_change() },
		{ key: 'reason', label: m.day_detail_history_column_reason() },
		{ key: 'actor', label: m.day_detail_history_column_actor() }
	];

	const historyRows: HistoryRow[] = $derived(
		data.transitions.map((transition) => ({
			when: formatDateTime(transition.createdAt),
			change: changeLabel(transition),
			reason: transition.reason,
			actor: actorLabel(transition.actor)
		}))
	);
</script>

<svelte:head
	><title>{m.day_detail_page_title({ date: formatDate(data.workUnit.date) })}</title></svelte:head
>

<main class="mx-auto max-w-2xl p-8">
	<h1 class="text-2xl font-semibold">
		{m.day_detail_heading({ date: formatDate(data.workUnit.date) })}
	</h1>
	<div class="mt-2"><DayStateBadge state={data.workUnit.state} /></div>

	<dl class="mt-6 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
		<dt class="opacity-70">{m.day_detail_contract_label()}</dt>
		<dd>{data.contract.title}</dd>
		<dt class="opacity-70">{m.day_detail_quantity_label()}</dt>
		<dd>{formatNumber(data.workUnit.quantity)}</dd>
		<dt class="opacity-70">{m.day_detail_scope_label()}</dt>
		<dd>{data.workUnit.scope}</dd>
		<dt class="opacity-70">{m.day_detail_amount_label()}</dt>
		<dd>
			{data.amount !== null
				? formatAmount(data.amount, data.contract.currency)
				: m.day_detail_amount_unpriced()}
		</dd>
		<dt class="opacity-70">{m.day_detail_approval_label()}</dt>
		<dd>
			{#if data.approval}
				{data.approval.sender} — {formatDateTime(data.approval.receivedAt)}
			{:else}
				{m.day_detail_approval_none()}
			{/if}
		</dd>
	</dl>

	{#if data.linkableApprovals.length > 0}
		<form method="POST" action="?/link" class="mt-6 flex flex-col gap-3 border p-4">
			<h2 class="text-base font-medium">{m.day_detail_approval_link_heading()}</h2>
			<label class="flex flex-col gap-1 text-sm">
				<span>{m.day_detail_approval_select_label()}</span>
				<select name="approvalId" required class="border px-3 py-2 text-base">
					<option value="" disabled selected>{m.day_detail_approval_select_placeholder()}</option>
					{#each data.linkableApprovals as approval (approval.id)}
						<option value={approval.id}
							>{approval.sender} — {formatDateTime(approval.receivedAt)}</option
						>
					{/each}
				</select>
			</label>
			{#if form?.linkError}<span class="text-sm text-red-700">{form.linkError}</span>{/if}
			<button type="submit" class="w-fit border px-4 py-2 text-sm">
				{m.day_detail_approval_link_submit()}
			</button>
		</form>
	{:else if data.workUnit.state === 'worked_without_approval'}
		<p class="mt-6 text-sm opacity-70">{m.day_detail_approval_link_empty()}</p>
	{/if}

	{#if data.transitions.length > 0}
		<section class="mt-8">
			<h2 class="text-base font-medium">{m.day_detail_history_heading()}</h2>
			<div class="mt-2">
				<DataTable columns={historyColumns} rows={historyRows} />
			</div>
		</section>
	{/if}

	<p class="mt-6 text-sm">
		<a href={resolve('/day/calendar')} class="underline">{m.day_detail_back_to_calendar()}</a>
	</p>
</main>
