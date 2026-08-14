<script lang="ts">
	/*
	 * Dialog.svelte — the one overlay for "confirm before something
	 * happens" (rejecting a proposal, and every other destructive action
	 * `docs/specs/2026-08-13-flows-audit.md` found with no confirmation at
	 * all) and "here is a focused task" (a sheet). #207: 0 of either
	 * existed, so a destructive click could not be walked back and nothing
	 * ever trapped keyboard focus.
	 *
	 * One component, not `Dialog.svelte` + `Sheet.svelte`: a centred modal
	 * and a bottom sheet are the same contract — focus trap, Escape,
	 * `aria-modal`, a backdrop, focus returned to the opener — and differ
	 * only in where the panel sits and how it enters. Splitting them would
	 * duplicate every line of that contract in a second file for a `top:
	 * 50%` vs `bottom: 0`; `placement` is the one prop that actually
	 * varies, so it stays one prop on one component (the same call Button
	 * already made for `<a>` vs `<button>`).
	 *
	 * The trap's arithmetic lives in dialog-focus.ts and is unit tested
	 * there — this file only supplies the real `HTMLElement[]` at the
	 * moment a key is pressed.
	 */
	import type { Snippet } from 'svelte';
	import * as m from '$lib/paraglide/messages';
	import { FOCUSABLE_SELECTOR, isDismissKey, nextTrappedIndex, tabDirection } from './dialog-focus';

	let {
		open = $bindable(false),
		title,
		placement = 'center',
		role = 'dialog',
		describedBy,
		children,
		actions
	}: {
		/** Bindable — closing (Escape, backdrop, the × button, or the caller
		 *  itself after a decision) always goes through this, never a
		 *  separate `onclose` the caller could forget to wire to it. */
		open?: boolean;
		/** The dialog's own heading — what `aria-labelledby` points at, so a
		 *  dialog is never unlabelled the way a `title` prop could be skipped. */
		title: string;
		/** `center`: a modal, page content dims behind it. `bottom`: a sheet
		 *  anchored to the viewport edge — the mobile-reachable shape for a
		 *  focused task, same trap and dismissal underneath. */
		placement?: 'center' | 'bottom';
		/** `alertdialog` for a destructive confirmation — the ARIA APG
		 *  distinction from a plain `dialog` doing routine content. */
		role?: 'dialog' | 'alertdialog';
		describedBy?: string;
		children: Snippet;
		/** The way forward: usually Cancel plus the destructive/primary action. */
		actions?: Snippet;
	} = $props();

	const titleId = $props.id();
	let panel = $state<HTMLElement | undefined>();
	let closeButton = $state<HTMLElement | undefined>();
	let openerElement: HTMLElement | null = null;

	// Captures the opener the instant the dialog opens and restores focus to
	// it the instant it closes — the ARIA APG's "focus returns to the
	// triggering control" requirement, and #207's own acceptance line for
	// it. Runs again on `placement`/`role` changes too since `$effect`
	// itself has no way to depend on `open` alone, but `open` is the only
	// one of the three that ever actually changes.
	$effect(() => {
		if (!open) return;
		openerElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		// The close × sits first in DOM order but is the least useful default
		// focus target — land on the first real control instead (typically
		// Cancel), falling back to close only when nothing else is focusable.
		const focusables = focusableElements();
		const initial = focusables.find((el) => el !== closeButton) ?? focusables[0];
		(initial ?? panel)?.focus();
		return () => {
			openerElement?.focus();
			openerElement = null;
		};
	});

	function focusableElements(): HTMLElement[] {
		if (!panel) return [];
		return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
	}

	function close() {
		open = false;
	}

	function onKeydown(event: KeyboardEvent) {
		if (isDismissKey(event.key)) {
			event.preventDefault();
			close();
			return;
		}
		const direction = tabDirection(event.key, event.shiftKey);
		if (direction === 0) return;
		const focusables = focusableElements();
		if (focusables.length === 0) return;
		const current = focusables.indexOf(document.activeElement as HTMLElement);
		const next = nextTrappedIndex(focusables.length, current, direction);
		if (next === -1) return;
		event.preventDefault();
		focusables[next]?.focus();
	}
</script>

{#if open}
	<div class="backdrop" onclick={close}>
		<div
			bind:this={panel}
			class="panel panel--{placement}"
			{role}
			aria-modal="true"
			aria-labelledby={titleId}
			aria-describedby={describedBy}
			tabindex="-1"
			onkeydown={onKeydown}
			onclick={(event) => event.stopPropagation()}
		>
			<div class="head">
				<h2 id={titleId} class="title">{title}</h2>
				<button
					type="button"
					class="close"
					bind:this={closeButton}
					onclick={close}
					aria-label={m.dialog_close_label()}
				>
					<span aria-hidden="true">×</span>
				</button>
			</div>
			<div class="body">{@render children()}</div>
			{#if actions}<div class="actions">{@render actions()}</div>{/if}
		</div>
	</div>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: flex;
		background: rgb(16 24 40 / 0.45);
		padding: var(--space-4);
	}
	.panel {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		max-height: 100%;
		overflow-y: auto;
		background: var(--surface-overlay);
		/* Elevation from --shadow-overlay only — cards stay flat (#207). */
		box-shadow: var(--shadow-overlay);
		border-radius: var(--radius-md);
		padding: var(--space-5);
	}
	.panel--center {
		margin: auto;
		width: min(480px, 100%);
	}
	.panel--bottom {
		margin-block-start: auto;
		width: 100%;
		max-width: 640px;
		margin-inline: auto;
		border-end-start-radius: 0;
		border-end-end-radius: 0;
		animation: sheet-in 180ms ease-out;
	}
	@media (prefers-reduced-motion: reduce) {
		.panel--bottom {
			animation: none;
		}
	}
	@keyframes sheet-in {
		from {
			transform: translateY(100%);
		}
		to {
			transform: translateY(0);
		}
	}
	.head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-3);
	}
	.title {
		margin: 0;
		font-size: var(--text-lg);
		font-weight: var(--weight-medium);
		color: var(--text-primary);
	}
	.close {
		flex: none;
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		margin: calc(var(--space-2) * -1);
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text-muted);
		font-size: var(--text-xl);
		line-height: 1;
		cursor: pointer;
	}
	.close:hover {
		background: var(--surface-2);
		color: var(--text-primary);
	}
	.body {
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
</style>
