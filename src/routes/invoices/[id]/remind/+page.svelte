<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import { formatDate, formatDateTime, formatDays, formatMinorUnits } from '$lib/i18n/format';
	import Page from '$lib/layout/Page.svelte';
	import type { DunningSendFormValues } from '$lib/server/repositories/dunning-form';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// `form?.values` is typed loosely by SvelteKit's generated `ActionData`
	// once a page has more than one named action — both `preview` and
	// `send` always return exactly `DunningSendFormValues` here (see
	// +page.server.ts), so this narrows what the generator could not.
	const values = $derived(
		(form?.values as DunningSendFormValues | undefined) ?? {
			templateId: data.templates[0]?.id ?? '',
			to: data.defaultRecipients
		}
	);
	const errors = $derived((form?.errors as Record<string, string> | undefined) ?? {});

	const subtitle = $derived(
		m.mail_dunning_summary({
			amount: formatMinorUnits(data.invoice.total, data.invoice.currency),
			dueDate: formatDate(data.invoice.dueDate),
			daysLate: formatDays(data.daysLate)
		})
	);
</script>

<svelte:head
	><title>{m.mail_dunning_page_title({ number: data.invoice.number })}</title></svelte:head
>

<Page crumbs={data.crumbs} title={m.mail_dunning_heading()} {subtitle}>
	{#if form?.sent}
		<p class="mt-4 border border-current p-3 text-sm">{m.mail_send_success()}</p>
	{/if}

	{#if data.templates.length === 0}
		<p class="mt-4 text-sm opacity-70">
			{m.mail_dunning_no_templates()}
			<a
				href={resolve('/mail/contracts/[id]/templates/new', { id: data.invoice.contractId })}
				class="underline"
			>
				{m.mail_contract_new_template_link()}
			</a>
		</p>
	{:else}
		<form method="POST" action="?/preview" class="mt-6 flex flex-col gap-4">
			<label class="flex flex-col gap-1 text-sm">
				{m.mail_dunning_form_template_label()}
				<select name="templateId" class="border px-2 py-1" required>
					{#each data.templates as template (template.id)}
						<option value={template.id} selected={values.templateId === template.id}>
							{template.name}
						</option>
					{/each}
				</select>
				{#if errors.templateId}<span class="text-xs font-semibold">{errors.templateId}</span>{/if}
			</label>

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

				{#if form.duplicate}
					<div class="border border-current p-3 text-sm">
						<p>
							{m.mail_dunning_duplicate_warning({
								template: form.duplicate.templateName,
								date: formatDateTime(form.duplicate.sentAt)
							})}
						</p>
						<label class="mt-2 flex items-center gap-2">
							<input
								type="checkbox"
								name="confirmDuplicate"
								value="true"
								form="dunning-send-form"
							/>
							{m.mail_dunning_duplicate_confirm_label()}
						</label>
					</div>
				{/if}
				{#if errors.confirmDuplicate}
					<span class="text-xs font-semibold">{errors.confirmDuplicate}</span>
				{/if}

				<form id="dunning-send-form" method="POST" action="?/send">
					<input type="hidden" name="templateId" value={values.templateId} />
					<input type="hidden" name="to" value={values.to} />
					<button type="submit" class="w-fit border px-4 py-2 text-sm font-semibold">
						{m.mail_send_confirm_button()}
					</button>
				</form>
			</section>
		{/if}
	{/if}
</Page>
