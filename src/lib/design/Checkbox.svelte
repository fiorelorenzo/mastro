<script lang="ts">
	/*
	 * Checkbox.svelte — a native `<input type="checkbox">` with its own
	 * label, hint and error. Unlike Input/Textarea/Select it does not read
	 * `field-context.ts`: a checkbox's label sits beside the box, not above
	 * it, so Field's label-above-control chrome doesn't fit, and a checkbox
	 * is almost never the sole control a `<Field>` wraps anyway (it is
	 * usually one of several, or the only control in a fieldset). It owns
	 * its id/aria wiring directly with the same field-ids.ts logic Field
	 * uses, so the contract — an error announces itself via aria-invalid and
	 * aria-describedby — holds here too.
	 */
	import type { HTMLInputAttributes } from 'svelte/elements';
	import { computeFieldIds } from './field-ids';

	let {
		checked = $bindable(false),
		label,
		hint,
		error,
		indeterminate = false,
		disabled = false,
		size = 'md',
		id,
		...rest
	}: {
		checked?: boolean;
		/** Visible text beside the box — a checkbox is never label-less. */
		label: string;
		hint?: string;
		error?: string;
		indeterminate?: boolean;
		disabled?: boolean;
		/** `md` matches `--row-comfortable`; `lg` is the mobile-critical size. */
		size?: 'md' | 'lg';
		id?: string;
	} & Omit<HTMLInputAttributes, 'type' | 'checked' | 'id' | 'disabled' | 'size'> = $props();

	const autoId = $props.id();
	const ids = $derived(
		computeFieldIds({ id: id ?? autoId, hasHint: Boolean(hint), hasError: Boolean(error) })
	);

	let inputEl: HTMLInputElement | undefined = $state();
	$effect(() => {
		if (inputEl) inputEl.indeterminate = indeterminate;
	});
</script>

<div class="wrap">
	<label class="check check--{size}" class:check--disabled={disabled}>
		<input
			{...rest}
			bind:this={inputEl}
			bind:checked
			type="checkbox"
			{disabled}
			id={ids.controlId}
			aria-invalid={Boolean(error) || undefined}
			aria-describedby={ids.describedBy}
		/>
		<span>{label}</span>
	</label>
	{#if hint}
		<p class="hint" id={ids.hintId}>{hint}</p>
	{/if}
	{#if error}
		<p class="err" id={ids.errorId} role="alert">{error}</p>
	{/if}
</div>

<style>
	.wrap {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.check {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		min-height: var(--row-comfortable);
		padding-block: var(--space-1);
		font-size: var(--text-sm);
		color: var(--text-primary);
		cursor: pointer;
	}
	.check input {
		flex-shrink: 0;
		width: var(--space-4);
		height: var(--space-4);
		margin-top: 2px;
		accent-color: var(--color-primary);
	}
	.check input[aria-invalid='true'] {
		outline: 1px solid var(--color-danger);
		outline-offset: 2px;
	}
	.check--disabled {
		color: var(--text-muted);
		cursor: not-allowed;
	}
	.check--lg {
		min-height: var(--space-touch);
	}
	.check--lg span {
		font-size: var(--text-md);
	}
	.hint,
	.err {
		margin: 0 0 0 calc(var(--space-4) + var(--space-2));
		font-size: var(--text-xs);
	}
	.hint {
		color: var(--text-muted);
	}
	.err {
		color: var(--color-danger);
		font-weight: var(--weight-medium);
	}
</style>
