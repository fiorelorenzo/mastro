<script lang="ts">
	/*
	 * SegmentedControl.svelte — one control replacing two that had already
	 * diverged: ChartFrame's chart/table toggle and day/new's full/half day
	 * buttons, each its own hand-rolled `<button>` row with its own ad hoc
	 * "selected" styling and no keyboard story beyond Tab-per-button.
	 *
	 * This is a set of toggle buttons acting as one control, not a native
	 * `<select>` and not a radiogroup — `role="group"` with `aria-pressed`
	 * per button is the ARIA APG "segmented button" pattern. Roving tabindex
	 * makes the whole group one Tab stop: the selected option is always the
	 * tabbable one (`activeIndex`, derived from `value` — never a separately
	 * tracked, seed-once state, so it can never drift from the value it is
	 * supposed to reflect), and the arrow keys move both focus and the
	 * selection (the standard toggle-group behaviour: an arrow press is a
	 * selection, not just a focus move). `keyToDirection`/`nextEnabledIndex`
	 * (segmented-control.ts) are pure so that logic is unit-tested without
	 * mounting this component.
	 *
	 * `aria-invalid` has no meaning on `role="group"` or on a `<button>`
	 * (WAI-ARIA restricts it to widget roles like textbox/combobox/
	 * radiogroup/listbox) — an ancestor `<Field>`'s invalid state still
	 * reaches this control via `aria-describedby` (which is a global
	 * attribute) and the `.seg--invalid` visual treatment below.
	 */
	import { resolveControlState, useField } from './field-context';
	import { keyToDirection, nextEnabledIndex } from './segmented-control';

	let {
		options,
		value = $bindable<string>(),
		label,
		size = 'md',
		disabled = false,
		id
	}: {
		options: readonly { value: string; label: string; disabled?: boolean }[];
		value: string;
		/** Accessible name for the group — always required, a group is never unlabelled. */
		label: string;
		/** `md` matches `--row-comfortable`; `lg` meets `--space-touch` with room to spare. */
		size?: 'md' | 'lg';
		disabled?: boolean;
		id?: string;
	} = $props();

	const field = useField();
	const resolved = $derived(resolveControlState(field, { id: id ?? undefined }));

	const effectiveOptions = $derived(
		options.map((option) => ({ value: option.value, disabled: disabled || option.disabled }))
	);
	// The selected option is the roving-tabindex target; falls back to the
	// first option when `value` matches nothing (still one Tab stop, never
	// zero).
	const activeIndex = $derived.by(() => {
		const index = options.findIndex((option) => option.value === value);
		return index === -1 ? 0 : index;
	});

	let buttons: (HTMLButtonElement | undefined)[] = $state([]);

	function select(index: number) {
		const option = options[index];
		if (!option || disabled || option.disabled) return;
		value = option.value;
	}

	function onKeydown(event: KeyboardEvent) {
		const direction = keyToDirection(event.key);
		if (direction === 0) return;
		event.preventDefault();
		const next = nextEnabledIndex(effectiveOptions, activeIndex, direction);
		select(next);
		buttons[next]?.focus();
	}
</script>

<!-- The group is not a focus target (role="group" is deliberately
     non-interactive); this keydown handler is the roving-tabindex
     delegation point, and it only ever reacts to events bubbling up from
     the focused, properly tabbable <button> children. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	class="seg seg--{size}"
	class:seg--invalid={resolved.invalid}
	role="group"
	aria-label={label}
	id={resolved.id}
	aria-describedby={resolved.describedBy}
	onkeydown={onKeydown}
>
	{#each options as option, index (option.value)}
		<button
			bind:this={buttons[index]}
			type="button"
			aria-pressed={option.value === value}
			tabindex={index === activeIndex ? 0 : -1}
			disabled={disabled || option.disabled}
			onclick={() => select(index)}
		>
			{option.label}
		</button>
	{/each}
</div>

<style>
	.seg {
		display: inline-flex;
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-sm);
		overflow: hidden;
	}
	.seg--invalid {
		border-color: var(--color-danger);
	}
	.seg button {
		font: inherit;
		font-family: var(--font-ui);
		font-size: var(--text-sm);
		padding: var(--space-2) var(--space-3);
		min-height: var(--row-comfortable);
		background: var(--surface-1);
		color: var(--text-secondary);
		border: 0;
		cursor: pointer;
		transition: background-color 120ms ease;
	}
	.seg button + button {
		border-left: 1px solid var(--line);
	}
	.seg button:hover:not(:disabled) {
		background: var(--surface-2);
	}
	.seg button[aria-pressed='true'] {
		background: var(--color-primary);
		color: var(--color-primary-ink);
		font-weight: var(--weight-medium);
	}
	.seg button[aria-pressed='true']:hover:not(:disabled) {
		background: var(--color-primary);
	}
	.seg button:disabled {
		color: var(--text-muted);
		cursor: not-allowed;
	}
	.seg--lg button {
		min-height: var(--space-touch);
		font-size: var(--text-md);
		padding: var(--space-3) var(--space-4);
		flex: 1;
	}
</style>
