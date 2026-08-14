<script lang="ts">
	/*
	 * ClientForm.svelte — create/edit form for a client (#241). Four cards,
	 * in the order a person actually needs them: legal identity (country
	 * first, since it is what makes a tax id or VAT id legible), address,
	 * how the client wants to be notified, and who to talk to there. One
	 * contact renders by default; "add another" appends one client-side,
	 * with no ceiling and no free fifth-slot penalty the way four
	 * permanently-rendered blank cards used to impose.
	 *
	 * Every field routes through Field/Input/Select/Checkbox, which wire
	 * `aria-invalid`/`aria-describedby` themselves — no hand-rolled
	 * label/error markup left to drift out of sync with what the server
	 * actually validated.
	 */
	import * as m from '$lib/paraglide/messages';
	import { getLocale } from '$lib/paraglide/runtime';
	import { Button, Checkbox, Field, Input, Select, countryOptions } from '$lib/design';
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
			sdiCode: string;
			pecAddress: string;
		};
		contactSlots: ContactSlot[];
		errors?: Record<string, string>;
		submitLabel: string;
	} = $props();

	const emptyContact: ContactSlot = { name: '', email: '', phone: '', role: '', canApprove: false };

	// One card by default (#241's "under ten fields" case): seeded once from
	// the server-echoed `contactSlots`, never fewer than one so the form is
	// never contact-less. Plain HTML `method="POST"` navigates on submit
	// (no `use:enhance` in this app), so a failed submission re-mounts this
	// component with the server's own values — this `$state` initializer is
	// never stale.
	let contacts = $state<ContactSlot[]>(
		contactSlots.length > 0 ? contactSlots : [{ ...emptyContact }]
	);

	function addContact() {
		contacts.push({ ...emptyContact });
	}

	function removeContact(index: number) {
		contacts.splice(index, 1);
	}

	const countries = $derived(countryOptions(getLocale()));
</script>

<form method="POST" class="mt-6 flex flex-col gap-5">
	<fieldset class="card">
		<legend><h2>{m.client_form_legal_identity_legend()}</h2></legend>
		<Field label={m.client_form_legal_name_label()} error={errors.legalName} required>
			<Input name="legalName" value={values.legalName} required />
		</Field>
		<Field label={m.client_form_country_label()} error={errors.country} required>
			<Select name="country" value={values.country} required>
				<option value="" disabled selected={values.country === ''}>
					{m.client_form_country_placeholder()}
				</option>
				{#each countries as country (country.code)}
					<option value={country.code} selected={values.country === country.code}>
						{country.name}
					</option>
				{/each}
			</Select>
		</Field>
		<div class="grid-2">
			<Field label={m.client_form_tax_id_label()} error={errors.taxId}>
				<Input name="taxId" value={values.taxId} />
			</Field>
			<Field label={m.client_form_vat_id_label()} error={errors.vatId}>
				<Input name="vatId" value={values.vatId} />
			</Field>
		</div>
		<div class="grid-2">
			<Field
				label={m.client_form_sdi_code_label()}
				error={errors.sdiCode}
				hint={m.client_form_sdi_code_hint()}
			>
				<Input name="sdiCode" value={values.sdiCode} maxlength={7} />
			</Field>
			<Field label={m.client_form_pec_address_label()} error={errors.pecAddress}>
				<Input name="pecAddress" type="email" value={values.pecAddress} />
			</Field>
		</div>
	</fieldset>

	<fieldset class="card">
		<legend><h2>{m.client_form_address_legend()}</h2></legend>
		<Field label={m.client_form_address_line1_label()} error={errors.addressLine1}>
			<Input name="addressLine1" value={values.addressLine1} />
		</Field>
		<Field label={m.client_form_address_line2_label()} error={errors.addressLine2}>
			<Input name="addressLine2" value={values.addressLine2} />
		</Field>
		<div class="grid-2">
			<Field label={m.client_form_city_label()} error={errors.addressCity}>
				<Input name="addressCity" value={values.addressCity} />
			</Field>
			<Field label={m.client_form_postal_code_label()} error={errors.addressPostalCode}>
				<Input name="addressPostalCode" value={values.addressPostalCode} />
			</Field>
		</div>
		<Field label={m.client_form_region_label()} error={errors.addressRegion}>
			<Input name="addressRegion" value={values.addressRegion} />
		</Field>
	</fieldset>

	<fieldset class="card">
		<legend><h2>{m.client_form_notices_legend()}</h2></legend>
		<Field label={m.client_form_notice_channel_label()} error={errors.noticeChannel}>
			<Select name="noticeChannel" value={values.noticeChannel}>
				<!-- Selectable, not `disabled`: leaving it empty is a legitimate
				     answer now that the column is nullable, and a placeholder
				     nobody can return to would make the first accidental pick
				     permanent. -->
				<option value="" selected={values.noticeChannel === ''}>
					{m.client_form_notice_channel_placeholder()}
				</option>
				{#each noticeChannels as channel (channel)}
					<option value={channel} selected={values.noticeChannel === channel}>
						{noticeChannelLabel(channel)}
					</option>
				{/each}
			</Select>
		</Field>
	</fieldset>

	<fieldset class="card">
		<legend><h2>{m.client_form_contacts_legend()}</h2></legend>
		{#if errors.contacts}<p class="contacts-error" role="alert">{errors.contacts}</p>{/if}
		<input type="hidden" name="contactCount" value={contacts.length} />
		{#each contacts as contact, i (i)}
			<fieldset class="contact-card">
				<legend class="contact-heading">
					<span>{m.client_form_contact_heading({ position: i + 1 })}</span>
					{#if contacts.length > 1}
						<Button type="button" variant="tertiary" size="sm" onclick={() => removeContact(i)}>
							{m.client_form_contact_remove_label({ position: i + 1 })}
						</Button>
					{/if}
				</legend>
				<div class="grid-2">
					<Field label={m.client_form_contact_name_label()} error={errors[`contactName_${i}`]}>
						<Input name="contactName_{i}" bind:value={contact.name} />
					</Field>
					<Field label={m.client_form_contact_email_label()} error={errors[`contactEmail_${i}`]}>
						<Input name="contactEmail_{i}" type="email" bind:value={contact.email} />
					</Field>
				</div>
				<div class="grid-2">
					<Field label={m.client_form_contact_phone_label()}>
						<Input name="contactPhone_{i}" bind:value={contact.phone} />
					</Field>
					<Field label={m.client_form_contact_role_label()}>
						<Input name="contactRole_{i}" bind:value={contact.role} />
					</Field>
				</div>
				<Checkbox
					name="contactCanApprove_{i}"
					bind:checked={contact.canApprove}
					label={m.client_form_contact_can_approve_label()}
				/>
			</fieldset>
		{/each}
		<Button type="button" variant="secondary" onclick={addContact}>
			{m.client_form_contact_add_label()}
		</Button>
	</fieldset>

	<Button type="submit" variant="primary">{submitLabel}</Button>
</form>

<style>
	.card {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		background: var(--surface-1);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-card);
		padding: var(--space-5);
		margin: 0;
		min-width: 0;
	}
	.card > legend {
		padding: 0;
		width: 100%;
	}
	.card h2 {
		font-size: var(--text-lg);
		font-weight: var(--weight-medium);
		color: var(--text-primary);
		margin: 0 0 calc(-1 * var(--space-1)) 0;
	}
	.grid-2 {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-4);
	}
	.contact-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: var(--space-4);
		margin: 0;
		min-width: 0;
	}
	.contact-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		width: 100%;
		padding: 0;
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		color: var(--text-secondary);
	}
	.contacts-error {
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		color: var(--color-danger);
		margin: 0;
	}
	@media (max-width: 639px) {
		.grid-2 {
			grid-template-columns: 1fr;
		}
	}
</style>
