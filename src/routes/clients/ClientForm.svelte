<script lang="ts">
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

	const noticeChannels = ['email', 'certified_mail', 'registered_mail', 'courier', 'other'];
</script>

<form method="POST" class="mt-6 flex flex-col gap-6">
	<fieldset class="flex flex-col gap-3">
		<legend class="text-sm font-semibold">Legal identity</legend>
		<label class="flex flex-col gap-1 text-sm">
			Legal name
			<input name="legalName" value={values.legalName} class="border px-2 py-1" required />
			{#if errors.legalName}<span class="text-xs font-semibold">{errors.legalName}</span>{/if}
		</label>
		<label class="flex flex-col gap-1 text-sm">
			Tax id
			<input name="taxId" value={values.taxId} class="border px-2 py-1" required />
			{#if errors.taxId}<span class="text-xs font-semibold">{errors.taxId}</span>{/if}
		</label>
		<label class="flex flex-col gap-1 text-sm">
			VAT id
			<input name="vatId" value={values.vatId} class="border px-2 py-1" />
		</label>
		<label class="flex flex-col gap-1 text-sm">
			Country (ISO alpha-2)
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
		<legend class="text-sm font-semibold">Registered address</legend>
		<label class="flex flex-col gap-1 text-sm">
			Address line 1
			<input name="addressLine1" value={values.addressLine1} class="border px-2 py-1" required />
			{#if errors.addressLine1}<span class="text-xs font-semibold">{errors.addressLine1}</span>{/if}
		</label>
		<label class="flex flex-col gap-1 text-sm">
			Address line 2
			<input name="addressLine2" value={values.addressLine2} class="border px-2 py-1" />
		</label>
		<label class="flex flex-col gap-1 text-sm">
			City
			<input name="addressCity" value={values.addressCity} class="border px-2 py-1" required />
			{#if errors.addressCity}<span class="text-xs font-semibold">{errors.addressCity}</span>{/if}
		</label>
		<label class="flex flex-col gap-1 text-sm">
			Postal code
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
			Region / province
			<input name="addressRegion" value={values.addressRegion} class="border px-2 py-1" />
		</label>
	</fieldset>

	<fieldset class="flex flex-col gap-3">
		<legend class="text-sm font-semibold">Notices</legend>
		<label class="flex flex-col gap-1 text-sm">
			Notice channel
			<select name="noticeChannel" value={values.noticeChannel} class="border px-2 py-1" required>
				<option value="" disabled selected={values.noticeChannel === ''}>Choose a channel</option>
				{#each noticeChannels as channel (channel)}
					<option value={channel} selected={values.noticeChannel === channel}>{channel}</option>
				{/each}
			</select>
			{#if errors.noticeChannel}<span class="text-xs font-semibold">{errors.noticeChannel}</span
				>{/if}
		</label>
	</fieldset>

	<fieldset class="flex flex-col gap-4">
		<legend class="text-sm font-semibold">Contacts</legend>
		{#if errors.contacts}<span class="text-xs font-semibold">{errors.contacts}</span>{/if}
		<input type="hidden" name="contactCount" value={contactSlots.length} />
		{#each contactSlots as contact, i (i)}
			<div class="flex flex-col gap-1 border p-3 text-sm">
				<label class="flex flex-col gap-1">
					Name
					<input name="contactName_{i}" value={contact.name} class="border px-2 py-1" />
					{#if errors[`contactName_${i}`]}<span class="text-xs font-semibold"
							>{errors[`contactName_${i}`]}</span
						>{/if}
				</label>
				<label class="flex flex-col gap-1">
					Email
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
					Phone
					<input name="contactPhone_{i}" value={contact.phone} class="border px-2 py-1" />
				</label>
				<label class="flex flex-col gap-1">
					Role
					<input name="contactRole_{i}" value={contact.role} class="border px-2 py-1" />
				</label>
				<label class="flex items-center gap-2">
					<input type="checkbox" name="contactCanApprove_{i}" checked={contact.canApprove} />
					Can approve
				</label>
			</div>
		{/each}
	</fieldset>

	<button type="submit" class="w-fit border px-4 py-2 text-sm">{submitLabel}</button>
</form>
