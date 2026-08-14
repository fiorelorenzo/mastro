<!--
	Toast.svelte — the one place an asynchronous outcome gets announced
	(#207: 0 `aria-live` regions existed in the product before this). Mounted
	once, in the root layout, reading the page-wide `toasts` singleton
	(toast-store.svelte.ts) — any route pushes to it with
	`toasts.push('success', m.some_message())` and never renders a toast
	stack of its own.

	The host `<div>` is always in the DOM, `aria-live="polite"` from first
	paint, empty or not: a screen reader only reliably picks up mutations
	inside a live region that already existed when it was announced, not one
	whose `aria-live` attribute arrives at the same moment as its first
	child. Each toast entry additionally states its own `role`/`aria-live`
	so a `danger` one (see toast.ts's `toastRole`) escalates to assertive
	independent of the host's own politeness.

	Fixed-position, not in flow: a toast stacking or clearing must never
	reflow the page underneath it — the "stacking that does not jump the
	layout" half of #207.
-->
<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { toastPoliteness, toastRole } from './toast';
	import { toasts } from './toast-store.svelte';
</script>

<div class="host" aria-live="polite" aria-atomic="false">
	{#each toasts.toasts as toast (toast.id)}
		<div
			class="toast toast--{toast.tone}"
			role={toastRole(toast.tone)}
			aria-live={toastPoliteness(toast.tone)}
		>
			<span class="message">{toast.message}</span>
			<button
				type="button"
				class="dismiss"
				onclick={() => toasts.dismiss(toast.id)}
				aria-label={m.toast_dismiss_label()}
			>
				<span aria-hidden="true">×</span>
			</button>
		</div>
	{/each}
</div>

<style>
	.host {
		position: fixed;
		z-index: 200;
		bottom: var(--space-4);
		inset-inline: var(--space-4);
		display: flex;
		flex-direction: column-reverse;
		align-items: center;
		gap: var(--space-2);
		pointer-events: none;
	}
	.toast {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		max-width: min(420px, 100%);
		pointer-events: auto;
		background: var(--surface-overlay);
		/* Elevation from --shadow-overlay only — cards stay flat (#207). */
		box-shadow: var(--shadow-overlay);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-md);
		padding: var(--space-3) var(--space-4);
		font-size: var(--text-sm);
		color: var(--text-primary);
	}
	.toast--success {
		border-color: color-mix(in srgb, var(--status-good) 55%, transparent);
	}
	.toast--danger {
		border-color: color-mix(in srgb, var(--color-danger) 55%, transparent);
	}
	.message {
		min-width: 0;
	}
	.dismiss {
		flex: none;
		display: grid;
		place-items: center;
		width: 24px;
		height: 24px;
		margin-inline-start: auto;
		margin-block: calc(var(--space-1) * -1);
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text-muted);
		font-size: var(--text-md);
		line-height: 1;
		cursor: pointer;
	}
	.dismiss:hover {
		background: var(--surface-2);
		color: var(--text-primary);
	}
</style>
