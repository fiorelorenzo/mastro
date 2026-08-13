<script lang="ts">
	/*
	 * Input.svelte — a thin wrapper around the native `<input>`, never a
	 * replacement for it: `type="date"` stays the OS date picker, which is
	 * better on a phone than anything this component could draw, and this
	 * product is phone-first. What it adds over a bare `<input>` is the
	 * token-based look every input in the product should share, and — when
	 * used inside a `<Field>` — automatic id/aria-invalid/aria-describedby
	 * wiring via field-context.ts, with no props to remember to spread.
	 */
	import type { HTMLInputAttributes } from 'svelte/elements';
	import { parseAriaInvalid, resolveControlState, useField } from './field-context';

	let {
		value = $bindable<string | number | undefined>(),
		size = 'md',
		numeric = false,
		id,
		'aria-invalid': ariaInvalid,
		'aria-describedby': ariaDescribedby,
		required,
		...rest
	}: Omit<HTMLInputAttributes, 'size'> & {
		value?: string | number;
		/** `md` matches `--row-comfortable`; `lg` is the mobile-critical size. */
		size?: 'md' | 'lg';
		/** Tabular figures, right-aligned, monospaced — plain numeric entry (quantities, counts). */
		numeric?: boolean;
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

<input
	{...rest}
	bind:value
	id={resolved.id}
	class="control control--{size}"
	class:control--numeric={numeric}
	aria-invalid={resolved.invalid || undefined}
	aria-describedby={resolved.describedBy}
	required={resolved.required || undefined}
/>

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
	.control--numeric {
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		text-align: right;
	}
</style>
