<script lang="ts">
	/*
	 * Textarea.svelte — the native `<textarea>`, styled and, inside a
	 * `<Field>`, aria-wired the same way Input.svelte is. Vertical resize
	 * only: horizontal resize breaks a form's layout on a phone, which is
	 * where this product lives first.
	 */
	import type { HTMLTextareaAttributes } from 'svelte/elements';
	import { parseAriaInvalid, resolveControlState, useField } from './field-context';

	let {
		value = $bindable<string | undefined>(),
		id,
		'aria-invalid': ariaInvalid,
		'aria-describedby': ariaDescribedby,
		required,
		...rest
	}: HTMLTextareaAttributes = $props();

	const field = useField();
	const resolved = $derived(
		resolveControlState(field, {
			id: id ?? undefined,
			invalid: parseAriaInvalid(ariaInvalid),
			describedBy: ariaDescribedby ?? undefined,
			required: required ?? undefined
		})
	);
</script>

<textarea
	{...rest}
	bind:value
	id={resolved.id}
	class="control"
	aria-invalid={resolved.invalid || undefined}
	aria-describedby={resolved.describedBy}
	required={resolved.required || undefined}
></textarea>

<style>
	.control {
		box-sizing: border-box;
		width: 100%;
		font: inherit;
		font-family: var(--font-ui);
		font-size: var(--text-md);
		color: var(--text-primary);
		background: var(--surface-1);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		padding: var(--space-2) var(--space-3);
		min-height: calc(var(--row-comfortable) * 2);
		resize: vertical;
		transition:
			border-color 120ms ease,
			box-shadow 120ms ease;
	}
	.control:hover {
		border-color: var(--text-muted);
	}
	.control[aria-invalid='true'] {
		border-color: var(--color-danger);
	}
	.control:disabled {
		background: var(--surface-2);
		color: var(--text-muted);
		cursor: not-allowed;
		resize: none;
	}
</style>
