<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import type { MailSendFormValues } from '$lib/server/repositories/mail-send-form';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// `form?.values` is typed loosely by SvelteKit's generated `ActionData`
	// once a page has more than one named action — both `preview` and
	// `send` always return exactly `MailSendFormValues` here (see
	// +page.server.ts), so this narrows what the generator could not.
	const values = $derived(
		(form?.values as MailSendFormValues | undefined) ?? {
			periodFrom: '',
			periodTo: '',
			invoiceNumber: '',
			amount: '',
			dueDate: '',
			to: data.defaultRecipients
		}
	);
	const errors = $derived((form?.errors as Record<string, string> | undefined) ?? {});
</script>

<svelte:head><title>{m.mail_send_page_title({ name: data.template.name })}</title></svelte:head>

<main class="mx-auto max-w-3xl p-8">
	<h1 class="text-2xl font-semibold">{m.mail_send_heading({ name: data.template.name })}</h1>

	{#if form?.sent}
		<p class="mt-4 border border-current p-3 text-sm">{m.mail_send_success()}</p>
	{/if}

	<form method="POST" action="?/preview" class="mt-6 flex flex-col gap-4">
		<fieldset class="flex flex-col gap-3">
			<legend class="text-sm font-semibold">{m.mail_send_form_period_legend()}</legend>
			<p class="text-xs opacity-70">{m.mail_send_form_hint()}</p>
			<div class="flex flex-wrap gap-3">
				<label class="flex flex-col gap-1 text-sm">
					{m.register_period_from_label()}
					<input
						type="date"
						name="periodFrom"
						value={values.periodFrom}
						class="border px-2 py-1"
						required
					/>
				</label>
				<label class="flex flex-col gap-1 text-sm">
					{m.register_period_to_label()}
					<input
						type="date"
						name="periodTo"
						value={values.periodTo}
						class="border px-2 py-1"
						required
					/>
				</label>
			</div>
			{#if errors.period}<span class="text-xs font-semibold">{errors.period}</span>{/if}

			<label class="flex flex-col gap-1 text-sm">
				{m.mail_send_form_invoice_number_label()}
				<input
					name="invoiceNumber"
					value={values.invoiceNumber}
					class="border px-2 py-1"
					required
				/>
				{#if errors.invoiceNumber}<span class="text-xs font-semibold">{errors.invoiceNumber}</span
					>{/if}
			</label>
			<label class="flex flex-col gap-1 text-sm">
				{m.mail_send_form_amount_label()}
				<input name="amount" value={values.amount} class="border px-2 py-1" required />
				{#if errors.amount}<span class="text-xs font-semibold">{errors.amount}</span>{/if}
			</label>
			<label class="flex flex-col gap-1 text-sm">
				{m.mail_send_form_due_date_label()}
				<input
					type="date"
					name="dueDate"
					value={values.dueDate}
					class="border px-2 py-1"
					required
				/>
				{#if errors.dueDate}<span class="text-xs font-semibold">{errors.dueDate}</span>{/if}
			</label>
		</fieldset>

		<label class="flex flex-col gap-1 text-sm">
			{m.mail_send_to_label()}
			<textarea name="to" rows="2" class="border px-2 py-1">{values.to}</textarea>
			{#if errors.to}<span class="text-xs font-semibold">{errors.to}</span>{/if}
		</label>

		<button type="submit" class="w-fit border px-4 py-2 text-sm"
			>{m.mail_send_preview_button()}</button
		>
	</form>

	{#if form?.preview}
		<section class="mt-6 flex flex-col gap-3 border p-4 text-sm">
			<div>
				<span class="font-semibold">{m.mail_send_to_label()}:</span>
				{form.preview.to.join(', ')}
			</div>
			<div>
				<div class="font-semibold">{m.mail_send_subject_heading()}</div>
				<div>{form.preview.subject}</div>
			</div>
			<div>
				<div class="font-semibold">{m.mail_send_body_heading()}</div>
				<pre class="font-sans whitespace-pre-wrap">{form.preview.body}</pre>
			</div>
			<div>
				<div class="font-semibold">{m.mail_send_attachments_heading()}</div>
				{#if form.preview.attachments.length === 0}
					<div>{m.mail_send_no_attachments()}</div>
				{:else}
					<ul>
						{#each form.preview.attachments as attachment (attachment.filename)}
							<li>{attachment.filename} ({attachment.size} bytes)</li>
						{/each}
					</ul>
				{/if}
			</div>

			<form method="POST" action="?/send">
				<input type="hidden" name="periodFrom" value={values.periodFrom} />
				<input type="hidden" name="periodTo" value={values.periodTo} />
				<input type="hidden" name="invoiceNumber" value={values.invoiceNumber} />
				<input type="hidden" name="amount" value={values.amount} />
				<input type="hidden" name="dueDate" value={values.dueDate} />
				<input type="hidden" name="to" value={values.to} />
				<button type="submit" class="w-fit border px-4 py-2 text-sm font-semibold">
					{m.mail_send_confirm_button()}
				</button>
			</form>
		</section>
	{/if}
</main>
