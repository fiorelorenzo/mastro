<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { Button, Checkbox, Field, Radio, Textarea } from '$lib/design';
	import { submitting } from '$lib/design/submitting.svelte';
	let {
		values,
		errors = {},
		submitLabel
	}: {
		values: {
			name: string;
			subject: string;
			body: string;
			attachmentKinds: string[];
			triggerKind: string;
			triggerDays: string;
			triggerDaysAfterDue: string;
		};
		errors?: Record<string, string>;
		submitLabel: string;
	} = $props();

	// #387: `triggerKind` drives which `Radio` in the trigger group is
	// selected. Native radios read their initial `checked` from `values`
	// once and then let the browser own the choice; `Radio` instead needs
	// a bindable `group` to know which option is picked, so this mirrors
	// the same select-driven-state pattern `RateCardForm.svelte`'s `kind`
	// uses — seeded from `values`, then left alone by a background
	// `invalidateAll()` since this form's own submit already remounts it.
	let triggerKind = $state(values.triggerKind);
	const save = submitting();
</script>

<form method="POST" class="mt-6 flex flex-col gap-4" onsubmit={save.onsubmit}>
	{#if errors.placeholders}
		<p class="border border-current p-2 text-xs font-semibold">{errors.placeholders}</p>
	{/if}

	<label class="flex flex-col gap-1 text-sm">
		{m.mail_template_form_name_label()}
		<input name="name" value={values.name} class="border px-2 py-1" required />
		{#if errors.name}<span class="text-xs font-semibold">{errors.name}</span>{/if}
	</label>

	<label class="flex flex-col gap-1 text-sm">
		{m.mail_template_form_subject_label()}
		<input name="subject" value={values.subject} class="border px-2 py-1" required />
		{#if errors.subject}<span class="text-xs font-semibold">{errors.subject}</span>{/if}
	</label>

	<Field
		label={m.mail_template_form_body_label()}
		hint={m.mail_template_form_body_hint()}
		error={errors.body}
	>
		<Textarea name="body" rows={6} value={values.body}></Textarea>
	</Field>

	<fieldset class="flex flex-col gap-2">
		<legend class="text-sm font-semibold">{m.mail_template_form_attachments_legend()}</legend>
		<Checkbox
			name="attachmentKinds"
			value="day_register_pdf"
			checked={values.attachmentKinds.includes('day_register_pdf')}
			label={m.mail_attachment_day_register_pdf()}
		/>
		<Checkbox
			name="attachmentKinds"
			value="day_register_csv"
			checked={values.attachmentKinds.includes('day_register_csv')}
			label={m.mail_attachment_day_register_csv()}
		/>
	</fieldset>

	<fieldset class="flex flex-col gap-2">
		<legend class="text-sm font-semibold">{m.mail_template_form_trigger_legend()}</legend>
		<Radio
			name="triggerKind"
			value="manual"
			bind:group={triggerKind}
			label={m.mail_template_form_trigger_manual_label()}
		/>
		<Radio
			name="triggerKind"
			value="on_issue"
			bind:group={triggerKind}
			label={m.mail_template_form_trigger_on_issue_label()}
		/>
		<div class="flex items-center gap-2 text-sm">
			<Radio
				name="triggerKind"
				value="days_before_due"
				bind:group={triggerKind}
				label={m.mail_template_form_trigger_days_before_due_label()}
			/>
			<input
				type="number"
				name="triggerDays"
				min="1"
				value={values.triggerDays}
				class="w-20 border px-2 py-1"
			/>
		</div>
		<div class="flex items-center gap-2 text-sm">
			<Radio
				name="triggerKind"
				value="days_after_due"
				bind:group={triggerKind}
				label={m.mail_template_form_trigger_days_after_due_label()}
			/>
			<input
				type="number"
				name="triggerDaysAfterDue"
				min="1"
				value={values.triggerDaysAfterDue}
				class="w-20 border px-2 py-1"
			/>
		</div>
		{#if errors.triggerKind}<span class="text-xs font-semibold">{errors.triggerKind}</span>{/if}
		{#if errors.triggerDays}<span class="text-xs font-semibold">{errors.triggerDays}</span>{/if}
	</fieldset>

	<Button type="submit" variant="secondary" size="md" loading={save.busy}>{submitLabel}</Button>
</form>
