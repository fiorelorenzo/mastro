<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import { Button } from '$lib/design';
	import Page from '$lib/layout/Page.svelte';
	import ClientForm from '../ClientForm.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const emptyContact = { name: '', email: '', phone: '', role: '', canApprove: false };
	const contactSlots = $derived(form?.values.contacts ?? [emptyContact]);
	const values = $derived(
		form?.values ?? {
			legalName: '',
			taxId: '',
			vatId: '',
			country: '',
			addressLine1: '',
			addressLine2: '',
			addressCity: '',
			addressPostalCode: '',
			addressRegion: '',
			noticeChannel: '',
			sdiCode: '',
			pecAddress: ''
		}
	);
</script>

<svelte:head><title>{m.client_new_page_title()}</title></svelte:head>

<Page crumbs={data.crumbs} title={m.client_new_heading()}>
	{#snippet actions()}
		<Button variant="secondary" href={resolve('/clients/new/from-pdf')}>
			{m.client_new_from_pdf_link()}
		</Button>
	{/snippet}

	<ClientForm
		{values}
		{contactSlots}
		errors={form?.errors ?? {}}
		submitLabel={m.client_form_submit_create()}
	/>
</Page>
