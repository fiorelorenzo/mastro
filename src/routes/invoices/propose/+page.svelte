<script lang="ts">
	/*
	 * invoices/propose — the human trigger for #87's fallback lane. A PDF
	 * with no structured counterpart, archived under the contract and
	 * handed to the agent runner; the resulting proposal (number, date,
	 * client, lines, totals) shows up on `/proposals` once the next agent
	 * run drains it, the same review screen every other proposal already
	 * uses. This page does not wait for that: uploading only archives and
	 * queues, following `agent/enqueue.ts`'s own "propose later, never
	 * synchronously" boundary.
	 */
	import * as m from '$lib/paraglide/messages';
	import { Banner, Button, Field, DropZone } from '$lib/design';
	import Page from '$lib/layout/Page.svelte';
	import type { ActionData, PageProps } from './$types';

	let { data, form }: PageProps & { form: ActionData } = $props();
</script>

<svelte:head
	><title>{m.invoice_propose_page_title({ contract: data.contract.title })}</title></svelte:head
>

<Page crumbs={data.crumbs} title={m.invoice_propose_heading()} subtitle={data.contract.title}>
	<p class="intro">{m.invoice_propose_intro()}</p>

	{#if form?.error}
		<Banner tone="critical">{form.error}</Banner>
	{/if}

	<form method="POST" enctype="multipart/form-data" class="form">
		<Field label={m.invoice_propose_file_label()} required>
			<DropZone
				name="file"
				label={m.invoice_propose_file_button()}
				accept=".pdf,application/pdf"
				required
			/>
		</Field>

		<Button type="submit">{m.invoice_propose_submit()}</Button>
	</form>
</Page>

<style>
	.intro {
		margin-top: 0.5rem;
		font-size: 0.875rem;
		opacity: 0.7;
	}

	.form {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 1rem;
		margin-top: 1.5rem;
	}
</style>
