<script lang="ts">
	/*
	 * Field.svelte — the one place a form field's label, hint, error and aria
	 * wiring get written. The audit behind this wave counted 46 inputs styled
	 * inline as `class="border px-2 py-1"`, wrapped in a hand-rolled label
	 * with no `aria-invalid` and no `aria-describedby` — so a screen reader
	 * never connects an error message to the field it belongs to.
	 *
	 * Field does not render a control itself — it renders the label/hint/
	 * error chrome around one, computes that control's id (from the `id`
	 * prop, or Svelte's own `$props.id()` if none is given — see
	 * field-ids.ts) and hands its id/invalid/describedBy/required state to
	 * `field-context.ts`. Input, Textarea, Select and SegmentedControl read
	 * it from there automatically, so a form author writing `<Input
	 * bind:value={x} />` inside a `<Field>` gets the wiring without spreading
	 * anything by hand — the whole point, since "remember to spread three
	 * aria attributes on every field" is exactly the kind of rule that stops
	 * being followed by the fourth form.
	 */
	import type { Snippet } from 'svelte';
	import * as m from '$lib/paraglide/messages';
	import { computeFieldIds } from './field-ids';
	import { provideField } from './field-context';

	let {
		label,
		hint,
		error,
		required = false,
		id,
		children
	}: {
		label: string;
		hint?: string;
		error?: string;
		required?: boolean;
		/** Explicit id for the control; generated (and unique) if omitted. */
		id?: string;
		children: Snippet;
	} = $props();

	const autoId = $props.id();
	const ids = $derived(
		computeFieldIds({ id: id ?? autoId, hasHint: Boolean(hint), hasError: Boolean(error) })
	);
	const invalid = $derived(Boolean(error));

	provideField({
		get id() {
			return ids.controlId;
		},
		get invalid() {
			return invalid;
		},
		get describedBy() {
			return ids.describedBy;
		},
		get required() {
			return required;
		}
	});
</script>

<div class="field">
	<label class="label" for={ids.controlId}>
		{label}
		{#if required}
			<span class="required" aria-hidden="true">*</span>
			<span class="sr-only">{m.field_required_marker()}</span>
		{/if}
	</label>
	{@render children()}
	{#if hint}
		<p class="hint" id={ids.hintId}>{hint}</p>
	{/if}
	{#if error}
		<p class="err" id={ids.errorId} role="alert">{error}</p>
	{/if}
</div>

<style>
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.label {
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		color: var(--text-primary);
	}
	.required {
		color: var(--color-danger);
	}
	.hint {
		font-size: var(--text-xs);
		color: var(--text-muted);
		margin: 0;
	}
	.err {
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		color: var(--color-danger);
		margin: 0;
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
</style>
