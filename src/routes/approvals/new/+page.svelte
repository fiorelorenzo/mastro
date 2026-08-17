<script lang="ts">
	/*
	 * approvals/new — the human path for recording an approval (#210): the
	 * IMAP pipeline is no longer the only way "the client said yes" gets
	 * written down. Channel, sender, when it arrived, the verbatim excerpt
	 * the interpretation rests on, and the proof (a file or pasted text,
	 * archived as a document owned by the approval once it exists — see
	 * `repositories/approval.ts`'s `createApproval`). Built entirely from
	 * the design system's form primitives (#199/#200): this is their first
	 * real caller in a route.
	 *
	 * `data.channels` is `noticeChannel.enumValues`, read from the schema by
	 * the load function — never a second, hand-typed list of channel
	 * strings living here.
	 */
	import * as m from '$lib/paraglide/messages';
	import { formatDate } from '$lib/i18n/format';
	import { Button, DropZone, Field, Input, Select, Textarea } from '$lib/design';
	import Page from '$lib/layout/Page.svelte';
	import { noticeChannelLabel, type NoticeChannelValue } from '../../clients/notice-channel';
	import { submitting } from '$lib/design/submitting.svelte';
	import type { ActionData, PageProps } from './$types';

	let { data, form }: PageProps & { form: ActionData } = $props();

	const values = $derived(
		form?.values ?? {
			channel: '',
			sender: '',
			receivedAt: '',
			excerpt: '',
			confidential: false,
			proofText: ''
		}
	);
	const errors = $derived(form?.errors ?? {});

	const save = submitting();
</script>

<svelte:head
	><title>{m.approval_form_page_title({ contract: data.contract.title })}</title></svelte:head
>

<Page crumbs={data.crumbs} title={m.approval_form_heading()} subtitle={data.contract.title}>
	{#if data.workUnit}
		<p class="recovery-note">
			{m.approval_form_recovery_note({ date: formatDate(data.workUnit.date) })}
		</p>
	{/if}

	<form method="POST" enctype="multipart/form-data" class="form" onsubmit={save.onsubmit}>
		<Field label={m.approval_form_channel_label()} error={errors.channel} required>
			<Select name="channel" value={values.channel} required>
				<option value="" disabled selected={values.channel === ''}>
					{m.approval_form_channel_placeholder()}
				</option>
				{#each data.channels as channel (channel)}
					<option value={channel} selected={values.channel === channel}>
						{noticeChannelLabel(channel as NoticeChannelValue)}
					</option>
				{/each}
			</Select>
		</Field>

		<Field label={m.approval_form_sender_label()} error={errors.sender} required>
			<Input name="sender" value={values.sender} required />
		</Field>

		<Field label={m.approval_form_received_at_label()} error={errors.receivedAt} required>
			<Input type="datetime-local" name="receivedAt" value={values.receivedAt} required />
		</Field>

		<Field
			label={m.approval_form_excerpt_label()}
			hint={m.approval_form_excerpt_hint()}
			error={errors.excerpt}
			required
		>
			<Textarea name="excerpt" value={values.excerpt} rows={4} required></Textarea>
		</Field>

		<fieldset class="proof">
			<legend>{m.approval_form_proof_legend()}</legend>
			<p class="proof-hint">{m.approval_form_proof_hint()}</p>
			{#if errors.proof}<p class="proof-error" role="alert">{errors.proof}</p>{/if}

			<Field label={m.approval_form_proof_file_label()}>
				<DropZone name="proofFile" accept=".pdf,.eml,.png,.jpg,.jpeg,.txt" />
			</Field>

			<Field label={m.approval_form_proof_text_label()}>
				<Textarea name="proofText" value={values.proofText} rows={4}></Textarea>
			</Field>

			<label class="confidential">
				<input type="checkbox" name="confidential" checked={values.confidential} />
				{m.approval_form_confidential_label()}
			</label>
		</fieldset>

		<Button type="submit" variant="primary" loading={save.busy}>{m.approval_form_submit()}</Button>
	</form>
</Page>

<style>
	.form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		margin-top: var(--space-5);
	}
	.recovery-note {
		margin-top: var(--space-2);
		font-size: var(--text-sm);
		color: var(--text-muted);
	}
	.proof {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-md);
		padding: var(--space-4);
	}
	.proof legend {
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		color: var(--text-primary);
		padding: 0 var(--space-1);
	}
	.proof-hint {
		margin: 0;
		font-size: var(--text-xs);
		color: var(--text-muted);
	}
	.proof-error {
		margin: 0;
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		color: var(--color-danger);
	}
	.confidential {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-sm);
		color: var(--text-primary);
	}
</style>
