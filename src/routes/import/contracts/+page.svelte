<script lang="ts">
	/*
	 * import/contracts — the human trigger for #86's first-intake lane,
	 * and the third of the three importers, beside invoices and days. It
	 * used to live at `clients/new/from-pdf`, which put it behind "create
	 * a client" — backwards, since the contract is what you have in hand
	 * and the client may well already exist: choosing between an existing
	 * client and a new one is a decision the review screen now asks
	 * explicitly. A contract PDF is archived unclaimed and handed to the
	 * agent runner; the resulting proposal (client, contract terms, rate
	 * cards, any ambiguous clause flagged rather than decided) shows up on
	 * `/proposals` once the next agent run drains it. This page does not
	 * wait for that: uploading only archives and queues, following
	 * `agent/enqueue.ts`'s own "propose later, never synchronously"
	 * boundary — the same one `/invoices/propose` already uses.
	 */
	import * as m from '$lib/paraglide/messages';
	import { Banner, Button, Field, DropZone } from '$lib/design';
	import { Tabs } from '$lib/design';
	import { resolve } from '$app/paths';
	import Page from '$lib/layout/Page.svelte';
	import type { ActionData, PageProps } from './$types';

	let { data, form }: PageProps & { form: ActionData } = $props();

	const tabs = [
		{ href: resolve('/import'), label: m.import_tab_invoices(), selected: false },
		{ href: resolve('/import/days'), label: m.import_tab_days(), selected: false },
		{ href: resolve('/import/contracts'), label: m.import_tab_contracts(), selected: true }
	];
</script>

<svelte:head><title>{m.import_contracts_page_title()}</title></svelte:head>

<Page crumbs={data.crumbs} title={m.import_contracts_heading()} width="wide">
	<Tabs label={m.import_tabs_label()} {tabs} />

	<p class="intro">{m.import_contracts_intro()}</p>

	{#if form?.error}
		<Banner tone="critical">{form.error}</Banner>
	{/if}

	<form method="POST" enctype="multipart/form-data" class="form">
		<Field label={m.client_new_from_pdf_file_label()} required>
			<DropZone
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
