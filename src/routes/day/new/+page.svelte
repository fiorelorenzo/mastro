<script lang="ts">
	// The day-entry form (#24, redesigned for #236): the product's most
	// frequent gesture. Two fields carry real judgment — which contract,
	// what the day was for — everything else defaults to the fast case.
	// Removed entirely: the freeform "Quantità" field that duplicated the
	// full/half segmented control below it, and the permanent 9px keyboard
	// hint (now a `KeyboardHint` badge inside the Save button itself, which
	// hides itself below `pointer: coarse` — see that component).
	//
	// What's new: the selected contract's rate and the day's computed value
	// are visible before saving (`day-value.ts`'s client-safe pricing
	// preview — the server's own `priceRateCard`/`resolveRateCard` cannot be
	// bundled here, see that file), and choosing a contract that requires
	// prior approval with none attached raises a warning at the moment of
	// entry, offering "record as proposed" as the safe alternative — never
	// blocking the primary Save, which still knowingly proceeds into
	// `worked_without_approval` exactly as the state machine already does.
	//
	// The manual "link an existing approval" dropdown the old form had is
	// gone: attaching evidence at entry time now happens invisibly via the
	// `?approvalId=` deep link an alert action already sends (still
	// honoured, just no longer surfaced as a control to fiddle with for the
	// common case) — attaching it after the fact is `/day/[id]`'s job.
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import * as m from '$lib/paraglide/messages';
	import { formatAmount, formatDate, formatDays, formatHours } from '$lib/i18n/format';
	import {
		Banner,
		Button,
		Field,
		Input,
		KeyboardHint,
		SegmentedControl,
		Select,
		StatTile,
		StatusIndicator
	} from '$lib/design';
	import Page from '$lib/layout/Page.svelte';
	import { offlineQueue } from '$lib/pwa/offline-queue.svelte';
	import OfflineQueuePanel from './OfflineQueuePanel.svelte';
	import {
		previewDayValue,
		previewRatePerUnit,
		quantityModeForCard,
		ratePeriodFor,
		resolveActiveRateCard,
		type RateCardPreview,
		type RatePeriod
	} from './day-value';
	import type { ActionData, PageProps } from './$types';

	let { data, form }: PageProps & { form: ActionData } = $props();

	let formEl: HTMLFormElement | undefined = $state();

	// Every field below is bound, unlike the pre-#236 form: `date` and
	// `contractId` now drive the live "Vale" preview (which rate card
	// applies depends on both), not only `quantity`/`approvalId` as before.
	//
	// None of the four resync from `data` on a background `invalidateAll()`
	// (another tab's write, or #61's freshness push): they are the entry
	// being actively typed/picked, and `data.defaultDate`/
	// `data.defaultContractId`/`data.defaultApprovalId` are only ever
	// meant as the *first* pre-fill for an empty form, not a value to keep
	// re-imposing over whatever the person has since chosen.
	let date = $state(form?.values.date ?? data.defaultDate);
	let quantity = $state(form?.values.quantity ?? '1');
	let contractId = $state(form?.values.contractId ?? data.defaultContractId);
	let approvalId = $state(form?.values.approvalId ?? data.defaultApprovalId ?? '');

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

	// Set true on submit (native `onsubmit`, since `use:enhance`'s own
	// callback below only fires once SvelteKit is actually dispatching the
	// request) and cleared once `onSubmit`'s callback settles — either
	// path it can take (queued offline, or `update()` resolving a
	// redirect/failure) leaves the component mounted, unlike every plain
	// form elsewhere in this app, so nothing here can rely on a
	// navigation to reset it. Two submit buttons share one form (Save vs
	// "record as proposed"), so `pressedIntent` — not just `saving` alone
	// — decides which one's spinner lights up.
	let saving = $state(false);
	let pressedIntent = $state<'worked' | 'proposed'>('worked');

	function onFormSubmit(event: SubmitEvent) {
		const submitter = event.submitter as HTMLButtonElement | null;
		pressedIntent = submitter?.value === 'proposed' ? 'proposed' : 'worked';
		saving = true;
	}

	const selectedContract = $derived(data.contracts.find((c) => c.id === contractId));

	// The live "Vale" figure (#236): resolves the rate card active on
	// `date` and prices `quantity` against it — see day-value.ts for why
	// this is a duplicate of the server's own pricing rather than a round
	// trip per keystroke.
	const preview = $derived(
		selectedContract
			? previewDayValue(selectedContract.rateCards, date, Number(quantity) || 0)
			: null
	);
	const mode = $derived(quantityModeForCard(preview?.card ?? null));

	// The moment the warning speaks: a contract that requires written
	// approval, with none attached to this attempt. Never blocks Save —
	// the state machine already knows how to record that honestly
	// (`worked_without_approval`); this only says so first.
	const showApprovalWarning = $derived(
		Boolean(selectedContract?.requiresPriorApproval) && !approvalId
	);

	// `Input` wraps the native element now (component, not a plain
	// `<input>`), so a `use:` action can't target it directly — focusing
	// through the already-bound form ref instead. Avoids the `autofocus`
	// attribute (flagged by the a11y linter) the same way the action this
	// replaced did: same effect, the one field that actually needs typing
	// for the common case gets it, once, on mount.
	onMount(() => {
		offlineQueue.init();
		formEl?.querySelector<HTMLInputElement>('input[name="scope"]')?.focus();
	});

	// Switching contract invalidates whichever approval was picked for the
	// previous one — an approval belongs to exactly one contract, so
	// carrying the selection across a contract change would silently point
	// at the wrong evidence. Quantity resets too: a different contract can
	// switch the quantity control's whole meaning (day-fraction vs hours,
	// see day-value.ts's `quantityModeForCard`), so a value typed for one
	// meaning is never carried into the other.
	function onContractChange() {
		approvalId = '';
		quantity = '1';
	}

	// Ctrl/Cmd+Enter saves from anywhere in the form, not just the last
	// field — the desktop keyboard shortcut #24 asks for, alongside plain
	// Enter already submitting from the (single-line) scope field
	// natively. No `submitter`, so the request carries no `intent` field
	// at all — falling back to 'worked' (parseDayEntryForm's own default),
	// exactly the shortcut's intent: save it, don't propose it.
	function onKeydown(event: KeyboardEvent) {
		if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
			event.preventDefault();
			formEl?.requestSubmit();
		}
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
				date = data.defaultDate;
				quantity = '1';
				contractId = data.defaultContractId;
				approvalId = '';
				workUnitId = crypto.randomUUID();
				saving = false;
				return;
			}
			justQueued = false;
			// `update()` navigates away on a redirect (the success path) and
			// stays put on a validation `fail()` — either way, once it
			// resolves this component is either gone or needs its spinner
			// off again, so clearing `saving` after it is correct for both.
			await update();
			saving = false;
		};
	};

	const RATE_PERIOD_LABEL: Record<RatePeriod, () => string> = {
		hour: () => m.day_form_rate_period_hour(),
		day: () => m.day_form_rate_period_day(),
		month: () => m.day_form_rate_period_month(),
		quarter: () => m.day_form_rate_period_quarter(),
		year: () => m.day_form_rate_period_year()
	};

	/** "700,00 €/giorno" — one canonical unit of `card`, priced through the
	 *  same `previewRatePerUnit` the contract picker's own hint uses, never
	 *  a second read of `card.amount`. `null` when `card` cannot honestly
	 *  price one (see day-value.ts). */
	function rateText(contract: { currency: string }, card: RateCardPreview): string | null {
		const perUnit = previewRatePerUnit(card);
		if (perUnit === null) return null;
		const amountText = formatAmount(perUnit, contract.currency);
		const period = ratePeriodFor(card);
		return period ? `${amountText}/${RATE_PERIOD_LABEL[period]()}` : amountText;
	}

	/** The contract picker's own per-option hint — resolved against the
	 *  form's current `date` so it never claims a rate that would not
	 *  actually apply once saved. */
	function contractRateText(
		contract: (typeof data.contracts)[number],
		forDate: string
	): string | null {
		const card = resolveActiveRateCard(contract.rateCards, forDate);
		return card ? rateText(contract, card) : null;
	}

	const quantityPhrase = $derived.by(() => {
		if (mode === 'hours') return formatHours(Number(quantity) || 0);
		if (quantity === '1') return m.day_form_quantity_full();
		if (quantity === '0.5') return m.day_form_quantity_half();
		return formatDays(Number(quantity) || 0);
	});

	const valueText = $derived(
		selectedContract && preview?.amount != null
			? formatAmount(preview.amount, selectedContract.currency)
			: m.day_detail_amount_unpriced()
	);

	const valueSub = $derived.by(() => {
		if (!selectedContract || !preview) return quantityPhrase;
		const rate = rateText(selectedContract, preview.card);
		return rate ? `${rate} · ${quantityPhrase}` : quantityPhrase;
	});
</script>

<svelte:head><title>{m.day_new_page_title()}</title></svelte:head>
<svelte:window onkeydown={onKeydown} />

<Page crumbs={data.crumbs} title={m.day_new_heading()}>
	{#if data.contracts.length === 0}
		<p class="empty-hint">{m.day_new_no_contracts()}</p>
	{:else}
		<form
			bind:this={formEl}
			method="POST"
			class="day-form"
			use:enhance={onSubmit}
			onsubmit={onFormSubmit}
		>
			<input type="hidden" name="workUnitId" value={workUnitId} />
			<input type="hidden" name="approvalId" value={approvalId} />

			<Field label={m.day_form_date_label()} error={form?.errors.date}>
				<Input type="date" name="date" bind:value={date} required size="lg" />
			</Field>

			<Field label={m.day_form_contract_label()} error={form?.errors.contractId}>
				<Select
					name="contractId"
					bind:value={contractId}
					onchange={onContractChange}
					required
					size="lg"
				>
					<option value="" disabled>{m.day_form_contract_placeholder()}</option>
					{#each data.contracts as contract (contract.id)}
						{@const rate = contractRateText(contract, date)}
						<option value={contract.id}
							>{contract.clientName} — {contract.title}{rate ? ` · ${rate}` : ''}</option
						>
					{/each}
				</Select>
			</Field>

			{#if showApprovalWarning}
				<Banner tone="warning">
					<strong>{m.day_form_approval_warning_heading({ date: formatDate(date) })}</strong>
					{m.day_form_approval_warning_body()}
					{#snippet actions()}
						<Button
							type="submit"
							name="intent"
							value="proposed"
							variant="secondary"
							size="sm"
							disabled={saving}
							loading={saving && pressedIntent === 'proposed'}
						>
							{m.day_form_record_as_proposed()}
						</Button>
					{/snippet}
				</Banner>
			{/if}

			<Field label={m.day_form_quantity_legend()} error={form?.errors.quantity}>
				{#if mode === 'hours'}
					<Input
						type="number"
						name="quantity"
						bind:value={quantity}
						inputmode="decimal"
						step="0.25"
						min="0.25"
						required
						size="lg"
					/>
				{:else}
					<SegmentedControl
						bind:value={quantity}
						label={m.day_form_quantity_legend()}
						size="lg"
						options={[
							{ value: '1', label: m.day_form_quantity_full() },
							{ value: '0.5', label: m.day_form_quantity_half() }
						]}
					/>
					<input type="hidden" name="quantity" value={quantity} />
				{/if}
			</Field>

			<Field label={m.day_form_scope_label()} error={form?.errors.scope}>
				<Input
					type="text"
					name="scope"
					value={form?.values.scope ?? ''}
					placeholder={m.day_form_scope_placeholder()}
					required
					size="lg"
				/>
			</Field>

			<StatTile label={m.day_form_value_label()} value={valueText} sub={valueSub} />

			<Button
				type="submit"
				name="intent"
				value="worked"
				variant="primary"
				size="lg"
				disabled={saving}
				loading={saving && pressedIntent === 'worked'}
			>
				{m.day_form_submit()}
				<KeyboardHint>{m.day_form_save_shortcut()}</KeyboardHint>
			</Button>
		</form>
		{#if justQueued}
			<div class="queued-notice" role="status">
				<StatusIndicator level="warning" label={m.day_offline_queued_notice()} />
			</div>
		{/if}
	{/if}

	<OfflineQueuePanel contracts={data.contracts} />
</Page>

<style>
	.day-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		margin-top: var(--space-6);
		max-width: 28rem;
	}
	.empty-hint {
		margin-top: var(--space-4);
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}
	.queued-notice {
		margin-top: var(--space-4);
		border: 1px solid var(--line-strong);
		border-radius: var(--radius-md);
		padding: var(--space-3) var(--space-4);
	}
</style>
