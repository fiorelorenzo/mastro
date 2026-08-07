<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import PageHeader from '$lib/nav/PageHeader.svelte';
	import ClauseNoteForm from '../ClauseNoteForm.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const values = $derived(
		form?.values ?? { clauseReference: '', verbatimText: '', interpretationAdopted: '', notes: '' }
	);
</script>

<svelte:head
	><title>{m.clause_note_new_page_title({ contract: data.contract.title })}</title></svelte:head
>

<main class="mx-auto max-w-3xl p-8">
	<PageHeader
		crumbs={data.crumbs}
		title={m.clause_note_new_heading({ contract: data.contract.title })}
	/>
	<ClauseNoteForm
		{values}
		errors={form?.errors ?? {}}
		submitLabel={m.clause_note_form_submit_create()}
	/>
</main>
