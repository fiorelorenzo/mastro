<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import ClientForm from '../ClientForm.svelte';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();

	const emptyContact = { name: '', email: '', phone: '', role: '', canApprove: false };
	const contactSlots = $derived(
		form?.values.contacts ?? [emptyContact, emptyContact, emptyContact, emptyContact]
	);
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
			noticeChannel: ''
		}
	);
</script>

<svelte:head><title>{m.client_new_page_title()}</title></svelte:head>

<main class="mx-auto max-w-3xl p-8">
	<h1 class="text-2xl font-semibold">{m.client_new_heading()}</h1>
	<ClientForm
		{values}
		{contactSlots}
		errors={form?.errors ?? {}}
		submitLabel={m.client_form_submit_create()}
	/>
</main>
