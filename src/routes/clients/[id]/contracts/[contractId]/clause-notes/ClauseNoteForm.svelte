<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { Button, Field, Textarea } from '$lib/design';
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
	<Field label={m.clause_note_form_verbatim_text_label()} error={errors.verbatimText} required>
		<Textarea name="verbatimText" rows={3} value={values.verbatimText} required></Textarea>
	</Field>
	<Field
		label={m.clause_note_form_interpretation_adopted_label()}
		error={errors.interpretationAdopted}
		required
	>
		<Textarea name="interpretationAdopted" rows={3} value={values.interpretationAdopted} required
		></Textarea>
	</Field>
	<Field label={m.clause_note_form_notes_label()}>
		<Textarea name="notes" rows={2} value={values.notes}></Textarea>
	</Field>

	<Button type="submit" variant="secondary" size="md" loading={save.busy}>{submitLabel}</Button>
</form>
