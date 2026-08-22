<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import { factLine } from '$lib/nav/crumbs';
	import Page from '$lib/layout/Page.svelte';
	import Section from '$lib/layout/Section.svelte';
	import { locales, type Locale } from '$lib/paraglide/runtime';
	import { formatBytes, formatDateTime } from '$lib/i18n/format';
	import { Button, Checkbox, EmptyState, Field, Select } from '$lib/design';
	import Table from '$lib/design/Table.svelte';
	import type { TableColumn } from '$lib/design/table';
	import { submitting } from '$lib/design/submitting.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type TemplateRow = PageData['templates'][number];
	type SkippedThreadRow = PageData['skippedThreads'][number];

	const autoSend = submitting();
	const templateLanguage = submitting();

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

	// Only reason today (#306). `inbound_thread_archived_shape`, the
	// table's own CHECK constraint, guarantees `messageSize` is set
	// whenever `skipReason` is, so the fallback below is unreachable, not
	// a real branch a future reason has to fill in.
	function skipReasonLabel(row: SkippedThreadRow): string {
		if (row.skipReason === 'oversized') {
			return m.mail_skip_reason_oversized({ size: formatBytes(row.messageSize ?? 0) });
		}
		return row.skipReason ?? '';
	}

	function attachmentLabel(kind: string): string {
		return kind === 'day_register_pdf'
			? m.mail_attachment_day_register_pdf()
			: m.mail_attachment_day_register_csv();
	}

	const templateLanguageError = $derived(
		form && 'templateLanguageError' in form ? form.templateLanguageError : undefined
	);
</script>

{#snippet sendCell(row: TemplateRow)}
	<a
		href={resolve('/mail/contracts/[id=uuid]/templates/[templateId=uuid]/send', {
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

{#snippet skippedReceivedCell(row: SkippedThreadRow)}
	{formatDateTime(row.receivedAt)}
{/snippet}

{#snippet skippedEmpty()}
	<EmptyState
		icon="⚠"
		title={m.mail_contract_skipped_heading()}
		body={m.mail_contract_skipped_empty()}
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
			href={resolve('/mail/contracts/[id=uuid]/register', { id: data.contract.id })}
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
				href={resolve('/mail/contracts/[id=uuid]/templates/new', { id: data.contract.id })}
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
				resolve('/mail/contracts/[id=uuid]/templates/[templateId=uuid]/edit', {
					id: data.contract.id,
					templateId: row.id
				})}
			empty={templatesEmpty}
		/>
	</Section>

	{@const skippedColumns = [
		{
			key: 'receivedAt',
			label: m.mail_contract_skipped_column_received(),
			cell: skippedReceivedCell
		},
		{
			key: 'subject',
			label: m.mail_contract_skipped_column_subject(),
			format: (row: SkippedThreadRow) => row.subject ?? ''
		},
		{
			key: 'reason',
			label: m.mail_contract_skipped_column_reason(),
			format: skipReasonLabel
		}
	] satisfies readonly TableColumn<SkippedThreadRow>[]}

	<Section title={m.mail_contract_skipped_heading()}>
		<Table
			columns={skippedColumns}
			rows={data.skippedThreads}
			caption={m.mail_contract_skipped_heading()}
			rowKey={(row) => row.id}
			empty={skippedEmpty}
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
</style>
