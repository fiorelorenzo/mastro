<script lang="ts">
	/*
	 * FileInput.svelte — the file picker every import screen should share.
	 *
	 * A native `<input type="file">` cannot be styled: the browser draws
	 * the button and writes its label ("Choose File", "No file chosen") in
	 * the *browser's* language, not the page's, so a raw one reads as
	 * English inside an Italian product and matches nothing else on the
	 * screen. Both import screens had hand-rolled their own, differently.
	 *
	 * So the input is visually hidden but kept in the accessibility tree
	 * and in the tab order (the usual `sr-only` trick, not
	 * `display: none`, which would remove it from both), and the label
	 * around it carries the button look. Keyboard and screen-reader
	 * behaviour stay the browser's own; only the drawing changes.
	 */
	import type { HTMLInputAttributes } from 'svelte/elements';
	import { parseAriaInvalid, resolveControlState, useField } from './field-context';

	let {
		files = $bindable<FileList | null>(null),
		label,
		size = 'md',
		id,
		'aria-invalid': ariaInvalid,
		'aria-describedby': ariaDescribedby,
		required,
		...rest
	}: Omit<HTMLInputAttributes, 'size' | 'type' | 'files'> & {
		files?: FileList | null;
		/** The button's own words — a file picker with no label says nothing. */
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

	/** The chosen file's name, or nothing — the native "no file chosen"
	 * copy is the browser's, in the browser's language, and this replaces
	 * it with the page's own silence. */
	const chosen = $derived(files && files.length > 0 ? files[0].name : null);
</script>

<div class="picker picker--{size}">
	<label class="button">
		{label}
		<input
			{...rest}
			type="file"
			bind:files
			id={resolved.id}
			class="sr-only"
			aria-invalid={resolved.invalid || undefined}
			aria-describedby={resolved.describedBy}
			required={resolved.required || undefined}
		/>
	</label>
	{#if chosen}<span class="chosen">{chosen}</span>{/if}
</div>

<style>
	.picker {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		flex-wrap: wrap;
	}
	/* Deliberately the same surface, border and radius as Button's
	   secondary variant: a file picker is a button, and a second look for
	   one would be a second convention. */
	.button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-family: var(--font-ui);
		font-size: var(--text-md);
		font-weight: var(--weight-medium);
		color: var(--text-primary);
		background: var(--surface-1);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		padding: var(--space-2) var(--space-4);
		min-height: var(--row-comfortable);
		cursor: pointer;
		transition:
			border-color 120ms ease,
			background 120ms ease;
	}
	.button:hover {
		border-color: var(--text-muted);
		background: var(--surface-2);
	}
	/* The visible ring has to follow focus on the hidden input, since that
	   is what actually receives it. */
	.button:focus-within {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}
	.picker--lg .button {
		min-height: calc(var(--row-comfortable) + var(--space-3));
		padding: var(--space-3) var(--space-5);
		font-size: var(--text-lg);
	}
	.chosen {
		font-size: var(--text-sm);
		color: var(--text-secondary);
		overflow-wrap: anywhere;
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
</style>
