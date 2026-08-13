<script lang="ts">
	/*
	 * Select.svelte — the native `<select>`, styled and aria-wired the same
	 * way as Input.svelte. Options are the caller's `<option>`/`<optgroup>`
	 * markup via `children`, not a `{value, label}[]` prop: a native select
	 * already has disabled options, groups and per-option attributes, and
	 * reinventing that shape here would be strictly less capable than what
	 * it wraps.
	 */
	import type { Snippet } from 'svelte';
	import type { HTMLSelectAttributes } from 'svelte/elements';
	import { parseAriaInvalid, resolveControlState, useField } from './field-context';

	let {
		value = $bindable<string | undefined>(),
		size = 'md',
		id,
		'aria-invalid': ariaInvalid,
		'aria-describedby': ariaDescribedby,
		required,
		children,
		...rest
	}: Omit<HTMLSelectAttributes, 'size'> & {
		/** `md` matches `--row-comfortable`; `lg` is the mobile-critical size. */
		size?: 'md' | 'lg';
		children: Snippet;
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
</script>

<select
	{...rest}
	bind:value
	id={resolved.id}
	class="control control--{size}"
	aria-invalid={resolved.invalid || undefined}
	aria-describedby={resolved.describedBy}
	required={resolved.required || undefined}
>
	{@render children()}
</select>

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
		min-height: var(--row-comfortable);
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
	}
	.control--lg {
		min-height: calc(var(--row-comfortable) + var(--space-3));
		padding: var(--space-3) var(--space-4);
		font-size: var(--text-lg);
	}
</style>
