<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { Button, Checkbox } from '$lib/design';
	import { submitting } from '$lib/design/submitting.svelte';
	import DropZone from '$lib/design/DropZone.svelte';
	import SourceDocument from '$lib/design/SourceDocument.svelte';
	import type { DocumentProvenanceValue } from '$lib/design/source-document';
	import type { ExpenseFormValues } from '$lib/server/repositories/expense-form';

	let {
		values,
		errors = {},
		submitLabel,
		existingReceipt = null
	}: {
		values: ExpenseFormValues;
		errors?: Record<string, string>;
		submitLabel: string;
		/** The receipt already on file, if any — the upload field is only
		 * offered when there is none yet, since a document is immutable
		 * once ingested (#49) and this form has no "replace" action. */
		existingReceipt?: {
			id: string;
			originalName: string;
			provenance: DocumentProvenanceValue;
			createdAt: string;
		} | null;
	} = $props();

	// Reveals the authorisation-reference field below when checked — the
	// user's own in-progress checkbox, not a mirror of `values` to keep in
	// sync. A background `invalidateAll()` leaves it alone for the same
	// reason `CeilingForm.svelte`'s `measure` does: this form's own submit
	// (plain POST, no `use:enhance`) already remounts with fresh `values`.
	let preAuthorised = $state(values.preAuthorised);
	const save = submitting();
</script>

<form
	method="POST"
	enctype="multipart/form-data"
	class="mt-6 flex flex-col gap-3"
	onsubmit={save.onsubmit}
>
	<label class="flex flex-col gap-1 text-sm">
		{m.expense_form_date_label()}
		<input type="date" name="date" value={values.date} class="border px-2 py-1" required />
		{#if errors.date}<span class="text-xs font-semibold">{errors.date}</span>{/if}
	</label>
	<label class="flex flex-col gap-1 text-sm">
		{m.expense_form_description_label()}
		<input name="description" value={values.description} class="border px-2 py-1" required />
		{#if errors.description}<span class="text-xs font-semibold">{errors.description}</span>{/if}
	</label>
	<label class="flex flex-col gap-1 text-sm">
		{m.expense_form_amount_label()}
		<input name="amount" value={values.amount} class="border px-2 py-1" required />
		{#if errors.amount}<span class="text-xs font-semibold">{errors.amount}</span>{/if}
	</label>
	<Checkbox
		name="preAuthorised"
		bind:checked={preAuthorised}
		label={m.expense_form_pre_authorised_label()}
	/>
	{#if preAuthorised}
		<label class="flex flex-col gap-1 text-sm">
			{m.expense_form_authorisation_reference_label()}
			<input
				name="authorisationReference"
				value={values.authorisationReference}
				class="border px-2 py-1"
				required
			/>
			<span class="text-xs opacity-70">{m.expense_form_authorisation_reference_hint()}</span>
			{#if errors.authorisationReference}<span class="text-xs font-semibold"
					>{errors.authorisationReference}</span
				>{/if}
		</label>
	{/if}

	<div class="flex flex-col gap-1 text-sm">
		{m.expense_form_receipt_label()}
		{#if existingReceipt}
			<SourceDocument document={existingReceipt} />
		{:else}
			<DropZone name="receipt" />
			<Checkbox name="receiptConfidential" label={m.expense_form_receipt_confidential_label()} />
		{/if}
	</div>

	<Button type="submit" variant="secondary" size="md" loading={save.busy}>{submitLabel}</Button>
</form>
