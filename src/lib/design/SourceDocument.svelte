<script lang="ts">
	/*
	 * SourceDocument.svelte — the one place an archived original renders
	 * (#215). Invariant 4 says every derived datum keeps its source
	 * document, and it does: an approval's proof, a proposal's source
	 * message, an imported invoice's own archived original, an expense's
	 * receipt are all a `document` row away. Until now `/documents/[id]`
	 * — auth-gated, working, serving the bytes back with
	 * `Content-Disposition: attachment` — was linked from nowhere (the
	 * 2026-08-13 flows audit, finding 6). This component is that link,
	 * rendered identically everywhere the row exists: the original file
	 * name, what kind of document it is, when it was archived, and a
	 * button that downloads it.
	 *
	 * `document` is nullable on purpose, and the `null` branch is not an
	 * empty state to skip past — for a product whose whole promise is
	 * evidence, "no source on file" is itself information (#215's brief).
	 * A caller with several documents for one owner (an invoice's own
	 * archive plus its attachments, a contract's still-unclaimed inbound
	 * mail) renders one instance per row instead of teaching this
	 * component about lists; `{#each rows as row}…{:else}` naturally
	 * renders the `null` case when the list is empty.
	 */
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import { formatDateTime } from '$lib/i18n/format';
	import Button from './Button.svelte';
	import { documentProvenanceLabel, type DocumentProvenanceValue } from './source-document';

	let {
		document
	}: {
		document: {
			id: string;
			originalName: string;
			provenance: DocumentProvenanceValue;
			/** ISO instant — every loader already converts its `Date` columns
			 *  this way before handing them to the client. */
			createdAt: string;
		} | null;
	} = $props();
</script>

{#if document}
	<div class="source-document">
		<div class="meta">
			<span class="name">{document.originalName}</span>
			<span class="detail">
				{documentProvenanceLabel(document.provenance)} · {m.source_document_archived_on({
					when: formatDateTime(document.createdAt)
				})}
			</span>
		</div>
		<Button
			href={resolve('/documents/[id=uuid]', { id: document.id })}
			variant="tertiary"
			size="sm"
		>
			{m.source_document_download()}
		</Button>
	</div>
{:else}
	<p class="none">{m.source_document_none()}</p>
{/if}

<style>
	.source-document {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		flex-wrap: wrap;
		padding: var(--space-2) 0;
	}
	.meta {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}
	.name {
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		color: var(--text-primary);
		overflow-wrap: anywhere;
	}
	.detail {
		font-size: var(--text-xs);
		color: var(--text-muted);
	}
	.none {
		margin: 0;
		padding: var(--space-2) 0;
		font-size: var(--text-sm);
		font-style: italic;
		color: var(--text-muted);
	}
</style>
