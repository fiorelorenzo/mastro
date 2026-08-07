<script lang="ts">
	import * as m from '$lib/paraglide/messages';

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
		};
		errors?: Record<string, string>;
		submitLabel: string;
	} = $props();
</script>

<form method="POST" class="mt-6 flex flex-col gap-4">
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

	<label class="flex flex-col gap-1 text-sm">
		{m.mail_template_form_body_label()}
		<textarea name="body" rows="6" class="border px-2 py-1">{values.body}</textarea>
		<span class="text-xs opacity-70">{m.mail_template_form_body_hint()}</span>
		{#if errors.body}<span class="text-xs font-semibold">{errors.body}</span>{/if}
	</label>

	<fieldset class="flex flex-col gap-2">
		<legend class="text-sm font-semibold">{m.mail_template_form_attachments_legend()}</legend>
		<label class="flex items-center gap-2 text-sm">
			<input
				type="checkbox"
				name="attachmentKinds"
				value="day_register_pdf"
				checked={values.attachmentKinds.includes('day_register_pdf')}
			/>
			{m.mail_attachment_day_register_pdf()}
		</label>
		<label class="flex items-center gap-2 text-sm">
			<input
				type="checkbox"
				name="attachmentKinds"
				value="day_register_csv"
				checked={values.attachmentKinds.includes('day_register_csv')}
			/>
			{m.mail_attachment_day_register_csv()}
		</label>
	</fieldset>

	<fieldset class="flex flex-col gap-2">
		<legend class="text-sm font-semibold">{m.mail_template_form_trigger_legend()}</legend>
		<label class="flex items-center gap-2 text-sm">
			<input
				type="radio"
				name="triggerKind"
				value="manual"
				checked={values.triggerKind === 'manual'}
			/>
			{m.mail_template_form_trigger_manual_label()}
		</label>
		<label class="flex items-center gap-2 text-sm">
			<input
				type="radio"
				name="triggerKind"
				value="on_issue"
				checked={values.triggerKind === 'on_issue'}
			/>
			{m.mail_template_form_trigger_on_issue_label()}
		</label>
		<label class="flex items-center gap-2 text-sm">
			<input
				type="radio"
				name="triggerKind"
				value="days_before_due"
				checked={values.triggerKind === 'days_before_due'}
			/>
			{m.mail_template_form_trigger_days_before_due_label()}
			<input
				type="number"
				name="triggerDays"
				min="1"
				value={values.triggerDays}
				class="w-20 border px-2 py-1"
			/>
		</label>
		{#if errors.triggerKind}<span class="text-xs font-semibold">{errors.triggerKind}</span>{/if}
		{#if errors.triggerDays}<span class="text-xs font-semibold">{errors.triggerDays}</span>{/if}
	</fieldset>

	<button type="submit" class="w-fit border px-4 py-2 text-sm">{submitLabel}</button>
</form>
