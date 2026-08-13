<script lang="ts">
	/**
	 * The one button. The 2026-08-13 UX review counted 21 distinct button
	 * class strings and, product-wide, 2 `:hover` rules, 3 `:focus-visible`
	 * rules, 1 disabled style and 0 loading affordances — every one of those
	 * numbers is a button that looked different from its neighbour or didn't
	 * respond to the pointer at all. This component is the only place a
	 * button's look is decided from here on: four variants, three sizes, and
	 * every state (hover/active/focus-visible/disabled/loading) drawn once.
	 *
	 * `href` exists because the product has 29 links standing in for buttons
	 * today, styled by hand or not at all — this is their legitimate home:
	 * same classes, same states, rendered as an `<a>` so it stays a link
	 * (keyboard `Tab` reaches it, not `Enter`-to-activate-a-div).
	 *
	 * `loading` never resizes the button: the label stays laid out (just
	 * hidden) and the spinner is an absolutely-positioned overlay, so a form
	 * that submits does not reflow under the person waiting for it.
	 */
	import type { Snippet } from 'svelte';
	import * as m from '$lib/paraglide/messages';
	import { appHref } from '$lib/nav/href';
	import {
		buttonAriaBusy,
		buttonClasses,
		isButtonBlocked,
		type ButtonSize,
		type ButtonVariant
	} from './button-classes';

	let {
		variant = 'secondary',
		size = 'md',
		type = 'button',
		disabled = false,
		loading = false,
		href,
		onclick,
		children,
		...rest
	}: {
		variant?: ButtonVariant;
		size?: ButtonSize;
		/** Ignored when `href` is set — an anchor has no submit behaviour. */
		type?: 'button' | 'submit';
		disabled?: boolean;
		loading?: boolean;
		/** Present renders an `<a>`; absent renders a `<button>`. */
		href?: string;
		onclick?: (event: MouseEvent) => void;
		children: Snippet;
		// The usual passthrough: `form`, `name`, `value`, `aria-*`, `id`… every
		// other native attribute a caller has a legitimate reason to set.
		[key: string]: unknown;
	} = $props();

	const classes = $derived(buttonClasses(variant, size));
	const blocked = $derived(isButtonBlocked(disabled, loading));

	// A real `<a>` has no `disabled` attribute, so a blocked link button is
	// pulled out of the tab order and its own click is swallowed here —
	// `pointer-events: none` in the stylesheet handles the pointer case, this
	// handles the keyboard one.
	function onAnchorClick(event: MouseEvent) {
		if (blocked) {
			event.preventDefault();
			return;
		}
		onclick?.(event);
	}
</script>

{#if href}
	<a
		{...rest}
		href={appHref(href)}
		class={classes}
		aria-disabled={blocked ? 'true' : undefined}
		aria-busy={buttonAriaBusy(loading)}
		tabindex={blocked ? -1 : undefined}
		onclick={onAnchorClick}
	>
		<span class="label">{@render children()}</span>
		{#if loading}
			<span class="spinner" aria-hidden="true"></span>
			<span class="sr-only">{m.button_loading()}</span>
		{/if}
	</a>
{:else}
	<button
		{...rest}
		{type}
		class={classes}
		disabled={blocked}
		aria-busy={buttonAriaBusy(loading)}
		{onclick}
	>
		<span class="label">{@render children()}</span>
		{#if loading}
			<span class="spinner" aria-hidden="true"></span>
			<span class="sr-only">{m.button_loading()}</span>
		{/if}
	</button>
{/if}

<style>
	/* Base: this is `variant="secondary"`, the neutral control every other
	   variant is a deviation from. Sizing lives in the `--size` modifiers;
	   colour lives in the `--variant` ones; states stack on top of both. */
	.btn {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		font-family: var(--font-ui);
		font-weight: var(--weight-medium);
		border-radius: var(--radius-sm);
		border: 1px solid var(--line-strong);
		background: var(--surface-1);
		color: var(--text-primary);
		cursor: pointer;
		white-space: nowrap;
		text-decoration: none;
		transition:
			background 120ms ease,
			border-color 120ms ease,
			color 120ms ease,
			opacity 120ms ease;
	}
	.label {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
	}

	/* ── size ─────────────────────────────────────────────────────────── */
	.btn--sm {
		font-size: var(--text-xs);
		padding: var(--space-1) var(--space-3);
	}
	.btn--md {
		font-size: var(--text-sm);
		padding: var(--space-2) var(--space-4);
		min-height: var(--row-compact);
	}
	.btn--lg {
		font-size: var(--text-md);
		padding: var(--space-3) var(--space-5);
		min-height: var(--space-touch);
	}

	/* ── variant × hover × active ────────────────────────────────────── */
	.btn--secondary:hover:not(:disabled):not([aria-disabled='true']) {
		background: var(--surface-2);
	}
	.btn--secondary:active:not(:disabled):not([aria-disabled='true']) {
		background: var(--line);
	}

	.btn--primary {
		background: var(--color-primary);
		border-color: var(--color-primary);
		color: var(--color-primary-ink);
	}
	.btn--primary:hover:not(:disabled):not([aria-disabled='true']) {
		filter: brightness(1.08);
	}
	.btn--primary:active:not(:disabled):not([aria-disabled='true']) {
		filter: brightness(0.92);
	}

	.btn--tertiary {
		background: transparent;
		border-color: transparent;
		color: var(--color-primary);
	}
	.btn--tertiary:hover:not(:disabled):not([aria-disabled='true']) {
		background: var(--surface-2);
	}
	.btn--tertiary:active:not(:disabled):not([aria-disabled='true']) {
		background: var(--line);
	}

	.btn--danger {
		background: transparent;
		border-color: var(--color-danger);
		color: var(--color-danger);
	}
	.btn--danger:hover:not(:disabled):not([aria-disabled='true']) {
		background: color-mix(in srgb, var(--color-danger) 12%, transparent);
	}
	.btn--danger:active:not(:disabled):not([aria-disabled='true']) {
		background: color-mix(in srgb, var(--color-danger) 20%, transparent);
	}

	/* ── disabled ─────────────────────────────────────────────────────
	   The audit found one disabled style in the whole product; this is the
	   only one anything needs from here on, for every variant at once. */
	.btn:disabled,
	.btn[aria-disabled='true'] {
		opacity: 0.45;
		cursor: not-allowed;
		filter: none;
		pointer-events: none;
	}

	/* ── loading ──────────────────────────────────────────────────────
	   The label keeps its layout box (just hidden) and the spinner is an
	   absolutely-positioned overlay, so the button never resizes. */
	.btn[aria-busy='true'] .label {
		visibility: hidden;
	}
	.spinner {
		display: none;
	}
	.btn[aria-busy='true'] .spinner {
		display: block;
		position: absolute;
		inset: 0;
		margin: auto;
		width: 1em;
		height: 1em;
		border: 0.15em solid currentcolor;
		border-top-color: transparent;
		border-radius: var(--radius-full);
		animation: btn-spin 700ms linear infinite;
	}
	@keyframes btn-spin {
		to {
			transform: rotate(360deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.spinner {
			animation: none;
		}
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
