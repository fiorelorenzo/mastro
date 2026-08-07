<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import ClientForm from '../../ClientForm.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const emptyContact = { name: '', email: '', phone: '', role: '', canApprove: false };
	const contactSlots = $derived(
		form?.values.contacts ?? [
			...data.client.contacts.map((contact) => ({
				name: contact.name,
				email: contact.email,
				phone: contact.phone ?? '',
				role: contact.role ?? '',
				canApprove: contact.canApprove
			})),
			emptyContact,
			emptyContact
		]
	);
	const values = $derived(
		form?.values ?? {
			legalName: data.client.legalName,
			taxId: data.client.taxId,
			vatId: data.client.vatId ?? '',
			country: data.client.country,
			addressLine1: data.client.addressLine1,
			addressLine2: data.client.addressLine2 ?? '',
			addressCity: data.client.addressCity,
			addressPostalCode: data.client.addressPostalCode,
			addressRegion: data.client.addressRegion ?? '',
			noticeChannel: data.client.noticeChannel
		}
	);
</script>

<svelte:head><title>{m.client_edit_page_title({ name: data.client.legalName })}</title></svelte:head
>

<main class="mx-auto max-w-3xl p-8">
	<h1 class="text-2xl font-semibold">{m.client_edit_heading({ name: data.client.legalName })}</h1>
	<ClientForm
		{values}
		{contactSlots}
		errors={form?.errors ?? {}}
		submitLabel={m.client_form_submit_save()}
	/>
</main>
