<script lang="ts">
	/*
	 * clients/new/from-pdf — the human trigger for #86's first-intake
	 * lane. A contract PDF for a counterparty that has no client row and
	 * no contract row yet, archived unclaimed and handed to the agent
	 * runner; the resulting proposal (client, contract terms, rate cards,
	 * any ambiguous clause flagged rather than decided) shows up on
	 * `/proposals` once the next agent run drains it. This page does not
	 * wait for that: uploading only archives and queues, following
	 * `agent/enqueue.ts`'s own "propose later, never synchronously"
	 * boundary — the same one `/invoices/propose` already uses.
	 */
	import * as m from '$lib/paraglide/messages';
	import { Banner, Button, Field, FileInput } from '$lib/design';
	import Page from '$lib/layout/Page.svelte';
	import type { ActionData, PageProps } from './$types';

	let { data, form }: PageProps & { form: ActionData } = $props();
</script>

<svelte:head><title>{m.client_new_from_pdf_page_title()}</title></svelte:head>

<Page crumbs={data.crumbs} title={m.client_new_from_pdf_heading()}>
	<p class="intro">{m.client_new_from_pdf_intro()}</p>

	{#if form?.error}
		<Banner tone="critical">{form.error}</Banner>
	{/if}

	<form method="POST" enctype="multipart/form-data" class="form">
		<Field label={m.client_new_from_pdf_file_label()} required>
			<FileInput
				name="file"
				label={m.client_new_from_pdf_file_button()}
				accept=".pdf,application/pdf"
				required
			/>
		</Field>

		<Button type="submit">{m.client_new_from_pdf_submit()}</Button>
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
