<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	function triggerLabel(trigger: (typeof data.templates)[number]['trigger']): string {
		if (trigger.kind === 'manual') return m.mail_trigger_manual();
		if (trigger.kind === 'on_issue') return m.mail_trigger_on_issue();
		return m.mail_trigger_days_before_due({ days: trigger.days });
	}

	function attachmentLabel(kind: string): string {
		return kind === 'day_register_pdf'
			? m.mail_attachment_day_register_pdf()
			: m.mail_attachment_day_register_csv();
	}
</script>

<svelte:head
	><title>{m.mail_contract_page_title({ contractTitle: data.contract.title })}</title></svelte:head
>

<main class="mx-auto max-w-3xl p-8">
	<h1 class="text-2xl font-semibold">
		{m.mail_contract_heading({ contractTitle: data.contract.title })}
	</h1>
	<p class="mt-1 text-sm opacity-70">{data.contract.client.legalName}</p>

	<a
		href={resolve('/mail/contracts/[id]/register', { id: data.contract.id })}
		class="mt-4 inline-block text-sm underline"
	>
		{m.mail_contract_register_link()}
	</a>

	<form method="POST" action="?/autoSend" class="mt-6 flex flex-col gap-2 border p-4">
		<span class="text-sm font-semibold">{m.mail_contract_auto_send_legend()}</span>
		<label class="flex items-center gap-2 text-sm">
			<input type="checkbox" name="autoSendMail" checked={data.contract.autoSendMail} />
			{m.mail_contract_auto_send_label()}
		</label>
		<p class="text-xs opacity-70">{m.mail_contract_auto_send_hint()}</p>
		<button type="submit" class="w-fit border px-4 py-2 text-sm"
			>{m.mail_contract_auto_send_save()}</button
		>
	</form>

	<div class="mt-6 flex items-center justify-between">
		<h2 class="text-lg font-semibold">{m.mail_contract_templates_heading()}</h2>
		<a
			href={resolve('/mail/contracts/[id]/templates/new', { id: data.contract.id })}
			class="text-sm underline"
		>
			{m.mail_contract_new_template_link()}
		</a>
	</div>

	{#if data.templates.length === 0}
		<p class="mt-2 text-sm opacity-70">{m.mail_contract_templates_empty()}</p>
	{:else}
		<table class="mt-2 w-full border-collapse text-sm">
			<thead>
				<tr class="border-b text-left">
					<th class="py-2 pr-4">{m.mail_template_column_name()}</th>
					<th class="py-2 pr-4">{m.mail_template_column_trigger()}</th>
					<th class="py-2 pr-4">{m.mail_template_column_attachments()}</th>
					<th class="py-2"></th>
				</tr>
			</thead>
			<tbody>
				{#each data.templates as template (template.id)}
					<tr class="border-b">
						<td class="py-2 pr-4">{template.name}</td>
						<td class="py-2 pr-4">{triggerLabel(template.trigger)}</td>
						<td class="py-2 pr-4">{template.attachmentKinds.map(attachmentLabel).join(', ')}</td>
						<td class="py-2 whitespace-nowrap">
							<a
								href={resolve('/mail/contracts/[id]/templates/[templateId]/edit', {
									id: data.contract.id,
									templateId: template.id
								})}
								class="underline">{m.mail_template_edit_link()}</a
							>
							<a
								href={resolve('/mail/contracts/[id]/templates/[templateId]/send', {
									id: data.contract.id,
									templateId: template.id
								})}
								class="ml-2 underline">{m.mail_template_send_link()}</a
							>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</main>
