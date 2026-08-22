<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import Page from '$lib/layout/Page.svelte';
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
				data.template.trigger.kind === 'days_before_due' ? String(data.template.trigger.days) : '',
			triggerDaysAfterDue:
				data.template.trigger.kind === 'days_after_due' ? String(data.template.trigger.days) : ''
		}
	);
</script>

<svelte:head
	><title>{m.mail_template_edit_page_title({ name: data.template.name })}</title></svelte:head
>

<Page crumbs={data.crumbs} title={m.mail_template_edit_heading({ name: data.template.name })}>
	{#snippet actions()}
		<a
			href={resolve('/mail/contracts/[id=uuid]/templates/[templateId=uuid]/send', {
				id: data.template.contractId,
				templateId: data.template.id
			})}
			class="text-sm underline"
		>
			{m.mail_template_send_link()}
		</a>
	{/snippet}
	<TemplateForm
		{values}
		errors={form?.errors ?? {}}
		submitLabel={m.mail_template_form_submit_save()}
	/>
</Page>
