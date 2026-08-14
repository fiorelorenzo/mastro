<script lang="ts">
	/*
	 * DropZone.svelte — the one file picker every screen shares (docs/specs/
	 * 2026-08-14-client-intake-design.md, "2. One drop zone, everywhere a
	 * file is chosen"). Replaces `FileInput` and every raw `<input
	 * type="file">` in the product: a second convention for choosing a file
	 * is exactly what the design system exists to prevent.
	 *
	 * Same trick `FileInput` used — a `<label>` wrapping a visually hidden
	 * but present `<input type="file">`, so keyboard focus, Enter/Space
	 * activation and the accessible name stay the browser's own rather than
	 * an imitation. What is new is the whole label surface accepting a drop:
	 * dragging a file over it highlights the zone, and dropping writes the
	 * files onto the *input* through a `DataTransfer` and dispatches a real
	 * `change` event on it, so `bind:files` and any `onchange` the caller
	 * passed see exactly what a native pick would have produced, and the
	 * surrounding `<form>` still submits without JavaScript at submit time.
	 * The drop only needs JavaScript to arrive; sending it needs none.
	 *
	 * `accept` only constrains the native picker — there is no platform
	 * hook that makes a browser's drag-and-drop consult it. So every
	 * dropped file is checked by hand against `accept` (`drop-zone.ts`'s
	 * `partitionByAccept`) before anything reaches the input, and a
	 * rejected drop is refused with a message naming what was expected,
	 * shown in a `Banner`, rather than silently accepted — the one behaviour
	 * that actually needs care here.
	 *
	 * Directory *drag-and-drop* is not implemented: reading a dropped
	 * folder's contents is a separate, much larger browser API
	 * (`webkitGetAsEntry`/`FileSystemDirectoryReader`) that nothing in this
	 * product's design calls for. `webkitdirectory` itself still flows
	 * through to the input via `...rest`, so the *click* path — the one
	 * `/import` actually depends on, alongside its own `showDirectoryPicker`
	 * button — keeps opening a folder picker exactly as it did on
	 * `FileInput`.
	 */
	import type { HTMLInputAttributes } from 'svelte/elements';
	import * as m from '$lib/paraglide/messages';
	import { parseAriaInvalid, resolveControlState, useField } from './field-context';
	import { acceptSummary, mergeSelection, partitionByAccept, removeFileAt } from './drop-zone';
	import Banner from './Banner.svelte';

	let {
		files = $bindable<FileList | null>(null),
		label,
		size = 'md',
		id,
		'aria-invalid': ariaInvalid,
		'aria-describedby': ariaDescribedby,
		required,
		multiple,
		accept,
		disabled,
		...rest
	}: Omit<HTMLInputAttributes, 'size' | 'type' | 'files'> & {
		files?: FileList | null;
		/** The zone's own words — a drop target with no label says nothing. */
		label: string;
		size?: 'md' | 'lg';
	} = $props();

	const field = useField();
	const resolved = $derived(
		resolveControlState(field, {
			id: id ?? undefined,
			invalid: parseAriaInvalid(ariaInvalid),
			describedBy: ariaDescribedby ?? undefined,
			required: required ?? undefined
		})
	);

	let inputEl: HTMLInputElement | undefined;
	// `dragenter`/`dragleave` fire on every child the pointer crosses, not
	// just the zone's own boundary — a depth counter is what keeps the
	// highlight from flickering off while the pointer is merely crossing
	// the label's own text.
	let dragDepth = 0;
	let dragActive = $state(false);
	let rejection = $state<{ names: string; expected: string } | null>(null);

	const chosen = $derived(files ? Array.from(files) : []);

	/** Writes `next` onto the real input as a `DataTransfer`-backed
	 *  `FileList`, then dispatches the `change` a native pick would have
	 *  fired — the one event both `bind:files` and the caller's own
	 *  `onchange` already know how to read. */
	function writeFiles(next: readonly File[]): void {
		if (!inputEl) return;
		const transfer = new DataTransfer();
		for (const file of next) transfer.items.add(file);
		inputEl.files = transfer.files;
		inputEl.dispatchEvent(new Event('change', { bubbles: true }));
	}

	function removeChosen(index: number): void {
		writeFiles(removeFileAt(chosen, index));
	}

	function acceptDrop(dropped: readonly File[]): void {
		const { accepted, rejected } = partitionByAccept(dropped, accept);
		rejection =
			rejected.length > 0
				? { names: rejected.map((file) => file.name).join(', '), expected: acceptSummary(accept) }
				: null;
		if (accepted.length > 0) writeFiles(mergeSelection(chosen, accepted, multiple ?? false));
	}

	function carriesFiles(event: DragEvent): boolean {
		return event.dataTransfer !== null && Array.from(event.dataTransfer.types).includes('Files');
	}

	function onDragEnter(event: DragEvent): void {
		if (disabled || !carriesFiles(event)) return;
		dragDepth += 1;
		dragActive = true;
	}
	function onDragOver(event: DragEvent): void {
		if (disabled || !carriesFiles(event)) return;
		// Only `preventDefault` here turns off the browser's own "navigate
		// to this file" drop behaviour and allows `drop` to fire at all.
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
	}
	function onDragLeave(): void {
		dragDepth = Math.max(0, dragDepth - 1);
		if (dragDepth === 0) dragActive = false;
	}
	function onDrop(event: DragEvent): void {
		if (disabled) return;
		event.preventDefault();
		dragDepth = 0;
		dragActive = false;
		const dropped = event.dataTransfer ? Array.from(event.dataTransfer.files) : [];
		if (dropped.length > 0) acceptDrop(dropped);
	}
</script>

<div class="zone zone--{size}" class:zone--drag={dragActive} class:zone--disabled={disabled}>
	<label
		class="surface"
		ondragenter={onDragEnter}
		ondragover={onDragOver}
		ondragleave={onDragLeave}
		ondrop={onDrop}
	>
		<span class="label">{label}</span>
		<span class="hint">{m.design_drop_zone_hint()}</span>
		<input
			{...rest}
			bind:this={inputEl}
			type="file"
			bind:files
			{multiple}
			{accept}
			{disabled}
			id={resolved.id}
			class="sr-only"
			aria-invalid={resolved.invalid || undefined}
			aria-describedby={resolved.describedBy}
			required={resolved.required || undefined}
		/>
	</label>

	{#if rejection}
		<Banner tone="critical">
			{m.design_drop_zone_rejected({ files: rejection.names, expected: rejection.expected })}
		</Banner>
	{/if}

	{#if chosen.length > 0}
		<ul class="chosen">
			{#each chosen as file, index (file.name + file.size + file.lastModified)}
				<li>
					<span class="name">{file.name}</span>
					<button
						type="button"
						class="remove"
						onclick={() => removeChosen(index)}
						aria-label={m.design_drop_zone_remove({ name: file.name })}
					>
						×
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.zone {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.surface {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-1);
		text-align: center;
		padding: var(--space-5) var(--space-4);
		border: 1px dashed var(--line-strong);
		border-radius: var(--radius-md);
		background: var(--surface-1);
		cursor: pointer;
		min-height: calc(var(--row-comfortable) * 2);
	}
	.surface:hover {
		border-color: var(--text-muted);
		background: var(--surface-2);
	}
	/* The visible ring has to follow focus on the hidden input, since that
	   is what actually receives it. */
	.surface:focus-within {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	.zone--drag .surface {
		border-color: var(--color-primary);
		background: color-mix(in srgb, var(--color-primary) 8%, var(--surface-1));
	}
	.zone--disabled .surface {
		cursor: not-allowed;
		background: var(--surface-2);
		color: var(--text-muted);
	}
	.label {
		font-family: var(--font-ui);
		font-size: var(--text-md);
		font-weight: var(--weight-medium);
		color: var(--text-primary);
	}
	.hint {
		font-size: var(--text-sm);
		color: var(--text-muted);
	}
	.zone--lg .surface {
		padding: var(--space-6) var(--space-5);
	}
	.zone--lg .label {
		font-size: var(--text-lg);
	}
	.chosen {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.chosen li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		background: var(--surface-1);
		font-size: var(--text-sm);
	}
	.name {
		overflow-wrap: anywhere;
		color: var(--text-secondary);
	}
	.remove {
		flex: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text-muted);
		font-size: var(--text-md);
		line-height: 1;
		cursor: pointer;
	}
	.remove:hover {
		color: var(--color-danger);
		background: var(--surface-2);
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
		border: 0;
	}
	/* prefers-reduced-motion: the highlight itself is only a colour/border
	   change, never a transition that fights the setting — this only ever
	   softens it under the default "no strong preference either way". */
	@media (prefers-reduced-motion: no-preference) {
		.surface {
			transition:
				border-color 120ms ease,
				background 120ms ease;
		}
		.remove {
			transition:
				color 120ms ease,
				background 120ms ease;
		}
	}
</style>
