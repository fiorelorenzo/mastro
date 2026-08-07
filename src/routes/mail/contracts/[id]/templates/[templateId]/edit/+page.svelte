<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import TemplateForm from '../../TemplateForm.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const values = $derived(
		form?.values ?? {
			name: data.template.name,
			subject: data.template.subject,
			body: data.template.body,
			attachmentKinds: data.template.attachmentKinds,
			triggerKind: data.template.trigger.kind,
			triggerDays:
				data.template.trigger.kind === 'days_before_due' ? String(data.template.trigger.days) : ''
		}
	);
</script>

<svelte:head
	><title>{m.mail_template_edit_page_title({ name: data.template.name })}</title></svelte:head
>

<main class="mx-auto max-w-3xl p-8">
	<h1 class="text-2xl font-semibold">
		{m.mail_template_edit_heading({ name: data.template.name })}
	</h1>
	<TemplateForm
		{values}
		errors={form?.errors ?? {}}
		submitLabel={m.mail_template_form_submit_save()}
	/>
</main>
