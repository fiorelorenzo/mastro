<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { Button } from '$lib/design';
	import { submitting } from '$lib/design/submitting.svelte';
	import type { ClauseNoteFormValues } from '$lib/server/repositories/clause-note-form';

	let {
		values,
		errors = {},
		submitLabel
	}: {
		values: ClauseNoteFormValues;
		errors?: Record<string, string>;
		submitLabel: string;
	} = $props();

	const save = submitting();
</script>

<form method="POST" class="mt-6 flex flex-col gap-3" onsubmit={save.onsubmit}>
	<label class="flex flex-col gap-1 text-sm">
		{m.clause_note_form_clause_reference_label()}
		<input
			name="clauseReference"
			value={values.clauseReference}
			class="border px-2 py-1"
			required
		/>
		{#if errors.clauseReference}<span class="text-xs font-semibold">{errors.clauseReference}</span
			>{/if}
	</label>
	<label class="flex flex-col gap-1 text-sm">
		{m.clause_note_form_verbatim_text_label()}
		<textarea name="verbatimText" rows="3" class="border px-2 py-1" required
			>{values.verbatimText}</textarea
		>
		{#if errors.verbatimText}<span class="text-xs font-semibold">{errors.verbatimText}</span>{/if}
	</label>
	<label class="flex flex-col gap-1 text-sm">
		{m.clause_note_form_interpretation_adopted_label()}
		<textarea name="interpretationAdopted" rows="3" class="border px-2 py-1" required
			>{values.interpretationAdopted}</textarea
		>
		{#if errors.interpretationAdopted}<span class="text-xs font-semibold"
				>{errors.interpretationAdopted}</span
			>{/if}
	</label>
	<label class="flex flex-col gap-1 text-sm">
		{m.clause_note_form_notes_label()}
		<textarea name="notes" rows="2" class="border px-2 py-1">{values.notes}</textarea>
	</label>

	<Button type="submit" variant="secondary" size="md" loading={save.busy}>{submitLabel}</Button>
</form>
