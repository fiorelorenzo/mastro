<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
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

<main class="mx-auto max-w-3xl p-8">
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-semibold">
			{m.clause_note_edit_heading({ contract: data.contract.title })}
		</h1>
		<a
			href={resolve('/clients/[id]/contracts/[contractId]', {
				id: data.contract.clientId,
				contractId: data.contract.id
			})}
			class="text-sm underline">{m.contract_back_to_detail_link()}</a
		>
	</div>
	<ClauseNoteForm
		{values}
		errors={form?.errors ?? {}}
		submitLabel={m.clause_note_form_submit_save()}
	/>
</main>
