<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import { formatDate } from '$lib/i18n/format';
	import DayStateBadge from '../../DayStateBadge.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head
	><title>{m.day_date_list_page_title({ date: formatDate(data.date) })}</title></svelte:head
>

<main class="mx-auto max-w-xl p-4 sm:p-8">
	<h1 class="text-2xl font-semibold">{m.day_date_list_heading({ date: formatDate(data.date) })}</h1>

	<ul class="mt-6 flex flex-col gap-3">
		{#each data.entries as entry (entry.id)}
			<li>
				<a href={resolve('/day/[id]', { id: entry.id })} class="flex items-center gap-3 border p-4">
					<DayStateBadge state={entry.state} compact />
					<span class="text-sm">{entry.contractLabel}</span>
				</a>
			</li>
		{/each}
	</ul>

	<p class="mt-6 text-sm">
		<a href={resolve(`/day/new?date=${data.date}`)} class="underline">
			{m.day_date_list_add_another({ date: formatDate(data.date) })}
		</a>
	</p>
</main>
