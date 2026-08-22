<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import { formatDate, formatMinorUnits } from '$lib/i18n/format';
	import Page from '$lib/layout/Page.svelte';
	import { Button, Field, Select, Textarea } from '$lib/design';
	import { submitting } from '$lib/design/submitting.svelte';
	import type { MailSendFormValues } from '$lib/server/repositories/mail-send-form';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const preview = submitting();
	const send = submitting();

	// `form?.values` is typed loosely by SvelteKit's generated `ActionData`
	// once a page has more than one named action — both `preview` and
	// `send` always return exactly `MailSendFormValues` here (see
	// +page.server.ts), so this narrows what the generator could not.
	const values = $derived(
		(form?.values as MailSendFormValues | undefined) ?? {
			invoiceId: data.invoices[0]?.id ?? '',
			to: data.defaultRecipients
		}
	);
	const errors = $derived((form?.errors as Record<string, string> | undefined) ?? {});

	// `resolve()` plus a query string: the navigation lint rule only
	// recognises a bare `resolve()` call in the attribute, so the value is
	// built here instead of inline.
	const newInvoiceHref = `${resolve('/invoices/new')}?contractId=${data.template.contractId}`;
</script>

<svelte:head><title>{m.mail_send_page_title({ name: data.template.name })}</title></svelte:head>

<Page crumbs={data.crumbs} title={m.mail_send_heading({ name: data.template.name })}>
	{#snippet actions()}
		<a
			href={resolve('/mail/contracts/[id=uuid]/templates/[templateId=uuid]/edit', {
				id: data.template.contractId,
				templateId: data.template.id
			})}
			class="text-sm underline"
		>
			{m.mail_template_edit_link()}
		</a>
	{/snippet}

	{#if form?.sent}
		<p class="mt-4 border border-current p-3 text-sm">{m.mail_send_success()}</p>
	{/if}

	{#if data.invoices.length === 0}
		<p class="mt-4 text-sm opacity-70">
			{m.mail_send_no_invoices()}
			<!-- `resolve('/invoices/new')` with a query string appended, built in
			     the script above. The rule only recognises a literal `resolve()`
			     call in the attribute and cannot express a resolved path plus a
			     query, which is what prefilling the contract needs. -->
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
			<a href={newInvoiceHref} class="underline">
				{m.invoices_new_link()}
			</a>
		</p>
	{:else}
		<form
			method="POST"
			action="?/preview"
			class="mt-6 flex flex-col gap-4"
			onsubmit={preview.onsubmit}
		>
			<Field label={m.mail_send_form_invoice_label()} error={errors.invoiceId} required>
				<Select name="invoiceId" value={values.invoiceId} required>
					{#each data.invoices as invoice (invoice.id)}
						<option value={invoice.id} selected={values.invoiceId === invoice.id}>
							{m.mail_send_form_invoice_option({
								number: invoice.number,
								dueDate: formatDate(invoice.dueDate),
								amount: formatMinorUnits(invoice.total, invoice.currency)
							})}
						</option>
					{/each}
				</Select>
			</Field>

			<Field label={m.mail_send_to_label()} error={errors.to}>
				<Textarea name="to" rows={2} value={values.to}></Textarea>
			</Field>

			<Button type="submit" variant="secondary" size="md" loading={preview.busy}>
				{m.mail_send_preview_button()}
			</Button>
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

				<form method="POST" action="?/send" onsubmit={send.onsubmit}>
					<input type="hidden" name="invoiceId" value={values.invoiceId} />
					<input type="hidden" name="to" value={values.to} />
					<Button type="submit" variant="primary" size="md" loading={send.busy}>
						{m.mail_send_confirm_button()}
					</Button>
				</form>
			</section>
		{/if}
	{/if}
</Page>
