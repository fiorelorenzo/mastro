<!--
	The global error boundary. Until now there was no file here, so every
	`error(404)` / `error(400)` thrown across 15+ load functions (a missing
	client, an invoice that was never created, a reminder guarded against a
	paid invoice…) fell through to SvelteKit's unstyled bundled fallback: a
	bare status code as an `h1`, no chrome, no way back (2026-08-13 review).

	This must render without the app shell or a session: the nearest
	successful `load` up the tree supplies `page.data`, and when the error
	came from the root `+layout.server.ts` itself (the ledger is down, say)
	there is no successful load at all — `data` here would be `{}`. So this
	page reads only `page.status` / `page.error`, never `data`, and stands
	on its own the same way `/sign-in` and `/offline` do: centred, narrow,
	no sidebar, a language switch, one safe way forward.

	404 and a non-404 4xx get different generic copy; a 5xx gets its own and
	never repeats the thrown message verbatim, even though `handleError`
	already strips detail in production for exactly this reason. When the
	4xx explanation is real (not one of SvelteKit's own fabricated
	placeholders — see error-status.ts) it is shown as the body, in prose,
	which is the actual fix for "a bare 400 in an h1".
-->
<script lang="ts">
	import { page } from '$app/state';
	import * as m from '$lib/paraglide/messages';
	import { appHref } from '$lib/nav/href';
	import LanguageSwitch from '$lib/components/LanguageSwitch.svelte';
	import ErrorState from '$lib/design/ErrorState.svelte';
	import { errorKind, hasExplanation } from '$lib/design/error-status';

	const status = $derived(page.status);
	const kind = $derived(errorKind(status));

	const title = $derived(
		kind === 'not-found'
			? m.error_page_title_not_found()
			: kind === 'server'
				? m.error_page_title_server()
				: m.error_page_title_bad_request()
	);

	const fallbackBody = $derived(
		kind === 'not-found'
			? m.error_page_body_not_found()
			: kind === 'server'
				? m.error_page_body_server()
				: m.error_page_body_bad_request()
	);

	// A 5xx explanation is never shown verbatim, whatever it says: the point
	// of a status boundary is to be trustworthy chrome even when the ledger
	// itself is broken, and the generic copy is the safe default.
	const explanation = $derived(page.error?.message);
	const body = $derived(
		kind !== 'server' && hasExplanation(explanation) ? explanation : fallbackBody
	);
</script>

<svelte:head><title>{title} — mastro</title></svelte:head>

<main class="shell">
	<div class="stack">
		<h1 class="brand">mastro</h1>
		<ErrorState {status} {title} message={body}>
			{#snippet actions()}
				<a class="btn btn--primary" href={appHref('/')}>{m.error_page_home()}</a>
				{#if kind === 'server'}
					<button type="button" class="btn" onclick={() => location.reload()}>
						{m.offline_page_retry()}
					</button>
				{/if}
			{/snippet}
		</ErrorState>
		<LanguageSwitch />
	</div>
</main>

<style>
	.shell {
		min-height: 80svh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-6) var(--space-4);
	}
	.stack {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-5);
		width: 100%;
		max-width: 28rem;
	}
	.brand {
		margin: 0;
		font-size: var(--text-2xl);
		font-weight: var(--weight-bold);
		color: var(--text-primary);
	}
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: var(--space-touch);
		padding: 0 var(--space-4);
		border-radius: var(--radius-sm);
		border: 1px solid var(--line-strong);
		background: var(--surface-overlay);
		color: var(--text-primary);
		font: inherit;
		font-weight: var(--weight-medium);
		text-decoration: none;
		cursor: pointer;
	}
	.btn:hover {
		background: var(--surface-2);
	}
	.btn--primary {
		background: var(--color-primary);
		border-color: var(--color-primary);
		color: var(--color-primary-ink);
	}
	.btn--primary:hover {
		filter: brightness(1.08);
	}
</style>
