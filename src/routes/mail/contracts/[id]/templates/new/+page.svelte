<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import PageHeader from '$lib/nav/PageHeader.svelte';
	import TemplateForm from '../TemplateForm.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const values = $derived(
		form?.values ?? {
			name: '',
			subject: '',
			body: '',
			attachmentKinds: [] as string[],
			triggerKind: 'manual',
			triggerDays: '',
			triggerDaysAfterDue: ''
		}
	);
</script>

<svelte:head><title>{m.mail_template_new_page_title()}</title></svelte:head>

<main class="mx-auto max-w-3xl p-8">
	<PageHeader crumbs={data.crumbs} title={m.mail_template_new_heading()} />
	<TemplateForm
		{values}
		errors={form?.errors ?? {}}
		submitLabel={m.mail_template_form_submit_create()}
	/>
</main>
