<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import Page from '$lib/layout/Page.svelte';
	import ClauseNoteForm from '../../ClauseNoteForm.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const values = $derived(
		form?.values ?? {
			clauseReference: data.clauseNote.clauseReference,
			verbatimText: data.clauseNote.verbatimText,
			interpretationAdopted: data.clauseNote.interpretationAdopted,
			notes: data.clauseNote.notes ?? ''
		}
	);
</script>

<svelte:head
	><title>{m.clause_note_edit_page_title({ contract: data.contract.title })}</title></svelte:head
>

<Page crumbs={data.crumbs} title={m.clause_note_edit_heading({ contract: data.contract.title })}>
	<ClauseNoteForm
		{values}
		errors={form?.errors ?? {}}
		submitLabel={m.clause_note_form_submit_save()}
	/>
</Page>
