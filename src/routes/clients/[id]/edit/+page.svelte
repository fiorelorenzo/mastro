<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import Page from '$lib/layout/Page.svelte';
	import ClientForm from '../../ClientForm.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const emptyContact = { name: '', email: '', phone: '', role: '', canApprove: false };
	const contactSlots = $derived(
		form?.values.contacts ??
			(data.client.contacts.length > 0
				? data.client.contacts.map((contact) => ({
						name: contact.name,
						email: contact.email,
						phone: contact.phone ?? '',
						role: contact.role ?? '',
						canApprove: contact.canApprove
					}))
				: [emptyContact])
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

<Page crumbs={data.crumbs} title={m.client_edit_heading({ name: data.client.legalName })}>
	<ClientForm
		{values}
		{contactSlots}
		errors={form?.errors ?? {}}
		submitLabel={m.client_form_submit_save()}
	/>
</Page>
