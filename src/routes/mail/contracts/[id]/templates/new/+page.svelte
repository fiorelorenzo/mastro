<script lang="ts">
	import * as m from '$lib/paraglide/messages';
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
	<h1 class="text-2xl font-semibold">{m.mail_template_new_heading()}</h1>
	<p class="mt-1 text-sm opacity-70">{data.contract.title}</p>
	<TemplateForm
		{values}
		errors={form?.errors ?? {}}
		submitLabel={m.mail_template_form_submit_create()}
	/>
</main>
