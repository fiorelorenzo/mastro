<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import { factLine } from '$lib/nav/crumbs';
	import Page from '$lib/layout/Page.svelte';
	import Section from '$lib/layout/Section.svelte';
	import { getLocale, locales, type Locale } from '$lib/paraglide/runtime';
	import { Badge, Button, Checkbox, EmptyState, Field, Input, Select } from '$lib/design';
	import Table from '$lib/design/Table.svelte';
	import type { TableColumn } from '$lib/design/table';
	import { submitting } from '$lib/design/submitting.svelte';
	import { mailPollBadge, mailPollMeta } from '../../poll-status';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type TemplateRow = PageData['templates'][number];

	const autoSend = submitting();
	const templateLanguage = submitting();
	const mailFolder = submitting();

	// Each language names itself, never translated (AGENTS.md invariant
	// 5's spirit applied to a language name — the same helper
	// `LanguageSwitch.svelte` uses for the interface locale picker).
	function autonym(locale: Locale): string {
		return new Intl.DisplayNames([locale], { type: 'language' }).of(locale) ?? locale;
	}

	function triggerLabel(trigger: TemplateRow['trigger']): string {
		if (trigger.kind === 'manual') return m.mail_trigger_manual();
		if (trigger.kind === 'on_issue') return m.mail_trigger_on_issue();
		if (trigger.kind === 'days_after_due')
			return m.mail_trigger_days_after_due({ days: trigger.days });
		return m.mail_trigger_days_before_due({ days: trigger.days });
	}

	function attachmentLabel(kind: string): string {
		return kind === 'day_register_pdf'
			? m.mail_attachment_day_register_pdf()
			: m.mail_attachment_day_register_csv();
	}

	const templateLanguageError = $derived(
		form && 'templateLanguageError' in form ? form.templateLanguageError : undefined
	);
	const mailFolderError = $derived(
		form && 'mailFolderError' in form ? form.mailFolderError : undefined
	);

	const locale = $derived(getLocale());
	const pollBadge = $derived(mailPollBadge(data.mailPoll.configured, data.mailPoll.health));
	const pollMeta = $derived(mailPollMeta(data.mailPoll.configured, data.mailPoll.health, locale));
</script>

{#snippet sendCell(row: TemplateRow)}
	<a
		href={resolve('/mail/contracts/[id]/templates/[templateId]/send', {
			id: data.contract.id,
			templateId: row.id
		})}
		class="underline"
	>
		{m.mail_template_send_link()}
	</a>
{/snippet}

{#snippet templatesEmpty()}
	<EmptyState
		icon="✎"
		title={m.mail_contract_templates_heading()}
		body={m.mail_contract_templates_empty()}
	/>
{/snippet}

<svelte:head
	><title>{m.mail_contract_page_title({ contractTitle: data.contract.title })}</title></svelte:head
>

<Page
	crumbs={data.crumbs}
	title={m.mail_contract_heading({ contractTitle: data.contract.title })}
	subtitle={factLine([
		data.contract.client.legalName,
		data.contract.autoSendMail
			? m.mail_contract_subtitle_auto_send_on()
			: m.mail_contract_subtitle_auto_send_off()
	])}
>
	{#snippet actions()}
		<a
			href={resolve('/mail/contracts/[id]/register', { id: data.contract.id })}
			class="text-sm underline"
		>
			{m.mail_contract_register_link()}
		</a>
	{/snippet}

	{@const templateColumns = [
		{ key: 'name', label: m.mail_template_column_name() },
		{
			key: 'trigger',
			label: m.mail_template_column_trigger(),
			format: (row: TemplateRow) => triggerLabel(row.trigger)
		},
		{
			key: 'attachments',
			label: m.mail_template_column_attachments(),
			format: (row: TemplateRow) => row.attachmentKinds.map(attachmentLabel).join(', ')
		},
		{ key: 'send', label: m.mail_template_send_link(), cell: sendCell }
	] satisfies readonly TableColumn<TemplateRow>[]}

	<Section title={m.mail_contract_templates_heading()}>
		{#snippet actions()}
			<a
				href={resolve('/mail/contracts/[id]/templates/new', { id: data.contract.id })}
				class="underline"
			>
				{m.mail_contract_new_template_link()}
			</a>
		{/snippet}
		<Table
			columns={templateColumns}
			rows={data.templates}
			caption={m.mail_contract_templates_heading()}
			rowKey={(row) => row.id}
			rowHref={(row) =>
				resolve('/mail/contracts/[id]/templates/[templateId]/edit', {
					id: data.contract.id,
					templateId: row.id
				})}
			empty={templatesEmpty}
		/>
	</Section>

	<Section title={m.mail_contract_settings_heading()}>
		<div class="settings-forms">
			<form method="POST" action="?/autoSend" class="card" onsubmit={autoSend.onsubmit}>
				<Checkbox
					name="autoSendMail"
					checked={data.contract.autoSendMail}
					label={m.mail_contract_auto_send_label()}
					hint={m.mail_contract_auto_send_hint()}
				/>
				<Button type="submit" variant="secondary" size="md" loading={autoSend.busy}>
					{m.mail_contract_auto_send_save()}
				</Button>
			</form>

			<form
				method="POST"
				action="?/templateLanguage"
				class="card"
				onsubmit={templateLanguage.onsubmit}
			>
				<Field
					label={m.mail_contract_template_language_legend()}
					hint={m.mail_contract_template_language_hint()}
					error={templateLanguageError}
				>
					<Select name="templateLanguage" value={data.contract.templateLanguage}>
						{#each locales as locale (locale)}
							<option value={locale} selected={data.contract.templateLanguage === locale}>
								{autonym(locale)}
							</option>
						{/each}
					</Select>
				</Field>
				<Button type="submit" variant="secondary" size="md" loading={templateLanguage.busy}>
					{m.mail_contract_template_language_save()}
				</Button>
			</form>

			<form method="POST" action="?/mailFolder" class="card" onsubmit={mailFolder.onsubmit}>
				<Field
					label={m.mail_contract_inbound_folder_legend()}
					hint={m.mail_contract_inbound_folder_hint()}
					error={mailFolderError}
				>
					<Input
						type="text"
						name="mailFolder"
						value={data.contract.mailFolder ?? ''}
						placeholder={m.mail_contract_inbound_folder_placeholder()}
					/>
				</Field>
				{#if data.contract.mailFolder}
					<div class="poll-status">
						<span class="poll-status-label">{m.mail_poll_status_heading()}</span>
						<Badge variant={pollBadge.variant} label={pollBadge.label} size="sm" />
						<p>{pollMeta}</p>
					</div>
				{/if}
				<Button type="submit" variant="secondary" size="md" loading={mailFolder.busy}>
					{m.mail_contract_inbound_folder_save()}
				</Button>
			</form>
		</div>
	</Section>
</Page>

<style>
	.settings-forms {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		background: var(--surface-1);
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-card);
		padding: var(--space-5);
		min-width: 0;
	}
	.poll-status {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-2) var(--space-3);
	}
	.poll-status-label {
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		color: var(--text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.02em;
	}
	.poll-status p {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}
</style>
