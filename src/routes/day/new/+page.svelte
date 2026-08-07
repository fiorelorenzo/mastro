<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { SubmitFunction } from '@sveltejs/kit';
	import * as m from '$lib/paraglide/messages';
	import { formatDateTime } from '$lib/i18n/format';
	import { StatusIndicator } from '$lib/design';
	import { offlineQueue } from '$lib/pwa/offline-queue.svelte';
	import OfflineQueuePanel from './OfflineQueuePanel.svelte';
	import type { ActionData, PageProps } from './$types';

	let { data, form }: PageProps & { form: ActionData } = $props();

	let formEl: HTMLFormElement | undefined = $state();

	// `date` has no JS-driven interactivity (unlike quantity/contractId/
	// approvalId below), so it stays a plain uncontrolled field, the same
	// pattern `ClientForm.svelte` uses — no $state needed.
	let quantity = $state(form?.values.quantity ?? '1');
	let contractId = $state(form?.values.contractId ?? data.defaultContractId);
	let approvalId = $state(form?.values.approvalId ?? '');

	// The idempotency key #62's offline queue and the server share (see
	// createWorkUnit): generated fresh for every attempt this page makes,
	// live or queued. Reusing form.values.workUnitId across a
	// validation-failure re-render keeps a fix-and-resubmit cycle under
	// one id, same as every other field here — nothing was persisted for
	// a failed attempt, so there is nothing to be idempotent against yet.
	let workUnitId = $state(form?.values.workUnitId || crypto.randomUUID());

	// Set right after a submission goes into the offline queue, cleared by
	// the next attempt — the inline confirmation that pairs with the
	// queue panel below to make the "pending, not saved" distinction
	// impossible to miss at the moment it matters most.
	let justQueued = $state(false);

	const selectedContract = $derived(data.contracts.find((c) => c.id === contractId));
	const approvalsForContract = $derived(data.approvalsByContract[contractId] ?? []);

	onMount(() => offlineQueue.init());

	// Switching contract invalidates whichever approval was picked for the
	// previous one — an approval belongs to exactly one contract, so
	// carrying the selection across a contract change would silently point
	// at the wrong evidence.
	function onContractChange() {
		approvalId = '';
	}

	// Ctrl/Cmd+Enter saves from anywhere in the form, not just the last
	// field — the desktop keyboard shortcut #24 asks for, alongside plain
	// Enter already submitting from the (single-line) scope field natively.
	function onKeydown(event: KeyboardEvent) {
		if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
			event.preventDefault();
			formEl?.requestSubmit();
		}
	}

	// Avoids the `autofocus` attribute (flagged by the a11y linter): same
	// effect, focuses the one field that actually needs typing for the
	// common case, via an action instead of a static HTML attribute.
	function autofocusOnMount(node: HTMLInputElement) {
		node.focus();
	}

	// #62: `use:enhance`'s own fetch throws when the request never reaches
	// the server at all (offline, DNS, a dropped connection mid-flight) —
	// SvelteKit hands that back as `result.type === 'error'` with no
	// `status`, the one shape a genuine server response (success, a
	// validation `failure`, or even an unexpected 500) never has. That is
	// the single signal this queues on: everything else — including every
	// validation error the action already returns via `fail()` — still
	// goes through SvelteKit's normal `update()`, unchanged.
	const onSubmit: SubmitFunction = () => {
		return async ({ formData, result, update }) => {
			if (result.type === 'error' && result.status === undefined) {
				await offlineQueue.enqueue(formData);
				justQueued = true;
				formEl?.reset();
				quantity = '1';
				contractId = data.defaultContractId;
				approvalId = '';
				workUnitId = crypto.randomUUID();
				return;
			}
			justQueued = false;
			await update();
		};
	};
</script>

<svelte:head><title>{m.day_new_page_title()}</title></svelte:head>
<svelte:window onkeydown={onKeydown} />

<main class="mx-auto max-w-xl p-8">
	<h1 class="text-2xl font-semibold">{m.day_new_heading()}</h1>

	{#if data.contracts.length === 0}
		<p class="mt-4 text-sm opacity-70">{m.day_new_no_contracts()}</p>
	{:else}
		<form bind:this={formEl} method="POST" class="mt-6 flex flex-col gap-6" use:enhance={onSubmit}>
			<input type="hidden" name="workUnitId" value={workUnitId} />
			<label class="flex flex-col gap-1 text-sm">
				<span>{m.day_form_date_label()}</span>
				<input
					type="date"
					name="date"
					value={form?.values.date ?? data.defaultDate}
					required
					class="w-fit border px-3 py-2 text-base"
				/>
				{#if form?.errors.date}<span class="text-sm text-red-700">{form.errors.date}</span>{/if}
			</label>

			<fieldset class="flex flex-col gap-2">
				<legend class="text-sm">{m.day_form_quantity_legend()}</legend>
				<div class="flex gap-2" role="group" aria-label={m.day_form_quantity_legend()}>
					<button
						type="button"
						class="quantity-preset"
						class:selected={quantity === '1'}
						onclick={() => (quantity = '1')}
					>
						{m.day_form_quantity_full()}
					</button>
					<button
						type="button"
						class="quantity-preset"
						class:selected={quantity === '0.5'}
						onclick={() => (quantity = '0.5')}
					>
						{m.day_form_quantity_half()}
					</button>
				</div>
				<label class="flex flex-col gap-1 text-sm opacity-80">
					<span>{m.day_form_quantity_custom_label()}</span>
					<input
						type="number"
						name="quantity"
						bind:value={quantity}
						step="0.25"
						min="0.25"
						required
						class="w-32 border px-3 py-2 text-base"
					/>
				</label>
				{#if form?.errors.quantity}<span class="text-sm text-red-700">{form.errors.quantity}</span
					>{/if}
			</fieldset>

			<label class="flex flex-col gap-1 text-sm">
				<span>{m.day_form_scope_label()}</span>
				<input
					type="text"
					name="scope"
					value={form?.values.scope ?? ''}
					placeholder={m.day_form_scope_placeholder()}
					required
					use:autofocusOnMount
					class="border px-3 py-2 text-base"
				/>
				{#if form?.errors.scope}<span class="text-sm text-red-700">{form.errors.scope}</span>{/if}
			</label>

			<label class="flex flex-col gap-1 text-sm">
				<span>{m.day_form_contract_label()}</span>
				<select
					name="contractId"
					bind:value={contractId}
					onchange={onContractChange}
					required
					class="border px-3 py-2 text-base"
				>
					<option value="" disabled>{m.day_form_contract_placeholder()}</option>
					{#each data.contracts as contract (contract.id)}
						<option value={contract.id}>{contract.clientName} — {contract.title}</option>
					{/each}
				</select>
				{#if form?.errors.contractId}<span class="text-sm text-red-700"
						>{form.errors.contractId}</span
					>{/if}
			</label>

			{#if selectedContract?.requiresPriorApproval}
				<label class="flex flex-col gap-1 text-sm">
					<span>{m.day_form_approval_label()}</span>
					<select name="approvalId" bind:value={approvalId} class="border px-3 py-2 text-base">
						<option value="">{m.day_form_approval_none_option()}</option>
						{#each approvalsForContract as approval (approval.id)}
							<option value={approval.id}
								>{approval.sender} — {formatDateTime(approval.receivedAt)}</option
							>
						{/each}
					</select>
					<span class="opacity-70">{m.day_form_approval_hint()}</span>
					{#if form?.errors.approvalId}<span class="text-sm text-red-700"
							>{form.errors.approvalId}</span
						>{/if}
				</label>
			{/if}

			<div class="flex flex-col gap-1">
				<button type="submit" class="w-fit border px-4 py-3 text-base font-medium">
					{m.day_form_submit()}
				</button>
				<span class="text-xs opacity-60">{m.day_form_keyboard_hint()}</span>
			</div>
		</form>
		{#if justQueued}
			<div class="queued-notice" role="status">
				<StatusIndicator level="warning" label={m.day_offline_queued_notice()} />
			</div>
		{/if}
	{/if}

	<OfflineQueuePanel contracts={data.contracts} />

	<p class="mt-6 text-sm">
		<a href={resolve('/day/calendar')} class="underline">{m.home_calendar_link()}</a>
	</p>
</main>

<style>
	.quantity-preset {
		border: 1px solid var(--border-hairline, currentColor);
		padding: 0.875rem 1.25rem;
		font-size: 1rem;
		background: var(--surface-1, transparent);
		min-height: 3rem;
		min-width: 8rem;
	}
	.quantity-preset.selected {
		background: var(--text-primary, #0b0b0b);
		color: var(--surface-1, #fcfcfb);
		border-color: var(--text-primary, #0b0b0b);
	}
	.queued-notice {
		margin-top: 1rem;
		border: 1px solid var(--border-hairline);
		padding: 0.625rem 1rem;
	}
</style>
