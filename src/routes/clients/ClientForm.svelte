<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { noticeChannelLabel, noticeChannels } from './notice-channel';

	type ContactSlot = {
		name: string;
		email: string;
		phone: string;
		role: string;
		canApprove: boolean;
	};

	let {
		values,
		contactSlots,
		errors = {},
		submitLabel
	}: {
		values: {
			legalName: string;
			taxId: string;
			vatId: string;
			country: string;
			addressLine1: string;
			addressLine2: string;
			addressCity: string;
			addressPostalCode: string;
			addressRegion: string;
			noticeChannel: string;
		};
		contactSlots: ContactSlot[];
		errors?: Record<string, string>;
		submitLabel: string;
	} = $props();
</script>

<form method="POST" class="mt-6 flex flex-col gap-6">
	<fieldset class="flex flex-col gap-3">
		<legend class="text-sm font-semibold">{m.client_form_legal_identity_legend()}</legend>
		<label class="flex flex-col gap-1 text-sm">
			{m.client_form_legal_name_label()}
			<input name="legalName" value={values.legalName} class="border px-2 py-1" required />
			{#if errors.legalName}<span class="text-xs font-semibold">{errors.legalName}</span>{/if}
		</label>
		<label class="flex flex-col gap-1 text-sm">
			{m.client_form_tax_id_label()}
			<input name="taxId" value={values.taxId} class="border px-2 py-1" required />
			{#if errors.taxId}<span class="text-xs font-semibold">{errors.taxId}</span>{/if}
		</label>
		<label class="flex flex-col gap-1 text-sm">
			{m.client_form_vat_id_label()}
			<input name="vatId" value={values.vatId} class="border px-2 py-1" />
		</label>
		<label class="flex flex-col gap-1 text-sm">
			{m.client_form_country_label()}
			<input
				name="country"
				value={values.country}
				maxlength="2"
				class="border px-2 py-1 uppercase"
				required
			/>
			{#if errors.country}<span class="text-xs font-semibold">{errors.country}</span>{/if}
		</label>
	</fieldset>

	<fieldset class="flex flex-col gap-3">
		<legend class="text-sm font-semibold">{m.client_form_address_legend()}</legend>
		<label class="flex flex-col gap-1 text-sm">
			{m.client_form_address_line1_label()}
			<input name="addressLine1" value={values.addressLine1} class="border px-2 py-1" required />
			{#if errors.addressLine1}<span class="text-xs font-semibold">{errors.addressLine1}</span>{/if}
		</label>
		<label class="flex flex-col gap-1 text-sm">
			{m.client_form_address_line2_label()}
			<input name="addressLine2" value={values.addressLine2} class="border px-2 py-1" />
		</label>
		<label class="flex flex-col gap-1 text-sm">
			{m.client_form_city_label()}
			<input name="addressCity" value={values.addressCity} class="border px-2 py-1" required />
			{#if errors.addressCity}<span class="text-xs font-semibold">{errors.addressCity}</span>{/if}
		</label>
		<label class="flex flex-col gap-1 text-sm">
			{m.client_form_postal_code_label()}
			<input
				name="addressPostalCode"
				value={values.addressPostalCode}
				class="border px-2 py-1"
				required
			/>
			{#if errors.addressPostalCode}<span class="text-xs font-semibold"
					>{errors.addressPostalCode}</span
				>{/if}
		</label>
		<label class="flex flex-col gap-1 text-sm">
			{m.client_form_region_label()}
			<input name="addressRegion" value={values.addressRegion} class="border px-2 py-1" />
		</label>
	</fieldset>

	<fieldset class="flex flex-col gap-3">
		<legend class="text-sm font-semibold">{m.client_form_notices_legend()}</legend>
		<label class="flex flex-col gap-1 text-sm">
			{m.client_form_notice_channel_label()}
			<select name="noticeChannel" value={values.noticeChannel} class="border px-2 py-1" required>
				<option value="" disabled selected={values.noticeChannel === ''}
					>{m.client_form_notice_channel_placeholder()}</option
				>
				{#each noticeChannels as channel (channel)}
					<option value={channel} selected={values.noticeChannel === channel}
						>{noticeChannelLabel(channel)}</option
					>
				{/each}
			</select>
			{#if errors.noticeChannel}<span class="text-xs font-semibold">{errors.noticeChannel}</span
				>{/if}
		</label>
	</fieldset>

	<fieldset class="flex flex-col gap-4">
		<legend class="text-sm font-semibold">{m.client_form_contacts_legend()}</legend>
		{#if errors.contacts}<span class="text-xs font-semibold">{errors.contacts}</span>{/if}
		<input type="hidden" name="contactCount" value={contactSlots.length} />
		{#each contactSlots as contact, i (i)}
			<div class="flex flex-col gap-1 border p-3 text-sm">
				<label class="flex flex-col gap-1">
					{m.client_form_contact_name_label()}
					<input name="contactName_{i}" value={contact.name} class="border px-2 py-1" />
					{#if errors[`contactName_${i}`]}<span class="text-xs font-semibold"
							>{errors[`contactName_${i}`]}</span
						>{/if}
				</label>
				<label class="flex flex-col gap-1">
					{m.client_form_contact_email_label()}
					<input
						name="contactEmail_{i}"
						value={contact.email}
						type="email"
						class="border px-2 py-1"
					/>
					{#if errors[`contactEmail_${i}`]}<span class="text-xs font-semibold"
							>{errors[`contactEmail_${i}`]}</span
						>{/if}
				</label>
				<label class="flex flex-col gap-1">
					{m.client_form_contact_phone_label()}
					<input name="contactPhone_{i}" value={contact.phone} class="border px-2 py-1" />
				</label>
				<label class="flex flex-col gap-1">
					{m.client_form_contact_role_label()}
					<input name="contactRole_{i}" value={contact.role} class="border px-2 py-1" />
				</label>
				<label class="flex items-center gap-2">
					<input type="checkbox" name="contactCanApprove_{i}" checked={contact.canApprove} />
					{m.client_form_contact_can_approve_label()}
				</label>
			</div>
		{/each}
	</fieldset>

	<button type="submit" class="w-fit border px-4 py-2 text-sm">{submitLabel}</button>
</form>
