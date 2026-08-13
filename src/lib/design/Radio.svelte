<script lang="ts">
	/*
	 * Radio.svelte — a native `<input type="radio">` with its own label,
	 * hint and error, one per option; several sharing a `name` (and bound to
	 * the same `group`) form the actual group. Same reasoning as
	 * Checkbox.svelte for owning its own id/aria wiring rather than reading
	 * `field-context.ts`: the label sits beside the button, and a radio
	 * group's error belongs to the group (typically a `<fieldset>` the
	 * caller wraps around several `Radio`s), not to any one option — each
	 * option still gets `error` wired onto itself so screen reader users hit
	 * it wherever they land in the group, not only on the first option.
	 */
	import type { HTMLInputAttributes } from 'svelte/elements';
	import { computeFieldIds } from './field-ids';

	let {
		group = $bindable(),
		value,
		label,
		name,
		hint,
		error,
		disabled = false,
		size = 'md',
		id,
		...rest
	}: {
		group?: string;
		/** This option's own value — what `group` becomes when it is picked. */
		value: string;
		label: string;
		/** Shared across every `Radio` in the same group. */
		name: string;
		hint?: string;
		error?: string;
		disabled?: boolean;
		/** `md` matches `--row-comfortable`; `lg` is the mobile-critical size. */
		size?: 'md' | 'lg';
		id?: string;
	} & Omit<
		HTMLInputAttributes,
		'type' | 'checked' | 'id' | 'disabled' | 'name' | 'value' | 'size'
	> = $props();

	const autoId = $props.id();
	const ids = $derived(
		computeFieldIds({ id: id ?? autoId, hasHint: Boolean(hint), hasError: Boolean(error) })
	);
</script>

<div class="wrap">
	<label
		class="radio radio--{size}"
		class:radio--disabled={disabled}
		class:radio--invalid={Boolean(error)}
	>
		<input
			{...rest}
			bind:group
			type="radio"
			{name}
			{value}
			{disabled}
			id={ids.controlId}
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
	.radio {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		min-height: var(--row-comfortable);
		padding-block: var(--space-1);
		font-size: var(--text-sm);
		color: var(--text-primary);
		cursor: pointer;
	}
	.radio input {
		flex-shrink: 0;
		width: var(--space-4);
		height: var(--space-4);
		margin-top: 2px;
		accent-color: var(--color-primary);
	}
	.radio--invalid input {
		outline: 1px solid var(--color-danger);
		outline-offset: 2px;
	}
	.radio--disabled {
		color: var(--text-muted);
		cursor: not-allowed;
	}
	.radio--lg {
		min-height: var(--space-touch);
	}
	.radio--lg span {
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
