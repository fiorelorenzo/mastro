<!--
	Manual invoice creation (#217, #216). The days and expenses to bill are
	ticked, never typed: each eligible day already carries what it prices to
	against the contract's own rate card (computed server-side in
	+page.server.ts's `load`, from the same `resolveRateCard`/
	`priceWorkUnitOnDate` the importer's day mapping uses), so the running
	total below reacts to the checkboxes with no round trip. The one place an
	amount is still typed is the manual line, kept and clearly labelled for
	the genuine exception the day/expense pickers cannot represent.

	Tax treatment, rate, statutory text and charges are resolved from the
	fiscal profile in force on the issue date and shown, never asked for —
	the manual fields only reappear as a fallback when no active profile has
	an opinion (`data.taxPreview.source === 'manual'`, e.g. the unmodelled
	`generic` pack).
-->
<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import { formatDate, formatMinorUnits, formatPercent } from '$lib/i18n/format';
	import {
		addMinorUnits,
		minorUnitsToDecimalString,
		sumMinorUnits,
		type MinorUnits
	} from '$lib/money';
	import Page from '$lib/layout/Page.svelte';
	import Amount from '$lib/design/Amount.svelte';
	import AmountInput from '$lib/design/AmountInput.svelte';
	import Button from '$lib/design/Button.svelte';
	import Checkbox from '$lib/design/Checkbox.svelte';
	import EmptyState from '$lib/design/EmptyState.svelte';
	import Field from '$lib/design/Field.svelte';
	import Input from '$lib/design/Input.svelte';
	import LegalText from '$lib/legal/LegalText.svelte';
	import { submitting } from '$lib/design/submitting.svelte';
	import type { InvoiceFormValues } from '$lib/server/repositories/invoice-form';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const documentTypes = [
		'invoice',
		'advance_on_invoice',
		'advance_on_fee_note',
		'credit_note',
		'debit_note',
		'fee_note'
	] as const;

	function documentTypeLabel(type: (typeof documentTypes)[number]): string {
		switch (type) {
			case 'invoice':
				return m.invoice_document_type_invoice();
			case 'advance_on_invoice':
				return m.invoice_document_type_advance_on_invoice();
			case 'advance_on_fee_note':
				return m.invoice_document_type_advance_on_fee_note();
			case 'credit_note':
				return m.invoice_document_type_credit_note();
			case 'debit_note':
				return m.invoice_document_type_debit_note();
			case 'fee_note':
				return m.invoice_document_type_fee_note();
		}
	}

	const selectedContract = $derived(
		data.contracts.find((c) => c.id === data.selectedContractId) ?? null
	);

	/**
	 * Built here rather than inline, the shape the mail send page already
	 * uses: `svelte/no-navigation-without-resolve` reads a native `<a href>`
	 * statically, so appending a query string to `resolve()` inside the
	 * attribute trips it even though the path itself is resolved. `/day/new`
	 * does consume `?contractId=` (`+page.server.ts:109`), so the link
	 * arrives with the contract already chosen.
	 */
	const recordDayHref = $derived(
		selectedContract
			? `${resolve('/day/new')}?contractId=${selectedContract.id}`
			: resolve('/day/new')
	);

	const values: InvoiceFormValues = $derived(
		form?.values ?? {
			contractId: data.selectedContractId,
			number: '',
			issueDate: '',
			documentType: 'invoice',
			currency: selectedContract?.currency ?? '',
			dueDate: '',
			paymentMethod: '',
			iban: '',
			transmissionId: '',
			correctsInvoiceId: '',
			workUnitIds: [],
			expenseIds: [],
			manualLineDescription: '',
			manualLineAmount: '',
			taxTreatmentCode: '',
			statutoryReferenceLanguage: '',
			statutoryReferenceText: '',
			taxRate: '',
			stampDuty: '',
			socialCharge: ''
		}
	);
	const errors: Record<string, string> = $derived(form?.errors ?? {});

	// Full-page form submission (no `use:enhance` here, matching the rest of
	// this form), so a failed resubmission is a fresh component instance —
	// initialising from `values` on mount is enough, no effect needed to
	// keep these in sync with a `form` that changes under a live instance.
	//
	// A background `invalidateAll()` (another tab's write, or #61's
	// freshness push) is a second way `data` can change under a mounted
	// instance, and still needs no effect here. `checkedDayIds`/
	// `checkedExpenseIds` are the reviewer's own in-progress picks; if a
	// checked day stops being eligible (invoiced or disputed elsewhere)
	// while this form is open, `dayTotal`/`expenseTotal` below already
	// self-correct because they iterate `data.eligibleDays`/
	// `data.eligibleExpenses`, not the checked-id lists, so a vanished id
	// silently drops out of both the total and the rendered checkbox
	// (nothing to uncheck). The create action re-validates every id
	// server-side regardless (`+page.server.ts`), so the worst case is an
	// inline error naming the field, never a wrong invoice.
	let checkedDayIds = $state<string[]>(values.workUnitIds);
	let checkedExpenseIds = $state<string[]>(values.expenseIds);

	// `documentType` and the credit-note fields below are `$state`, not
	// read straight off `values`, because picking a different original
	// invoice needs to *write* new defaults into `manualLineDescription`/
	// `manualLineAmount` (#213) — the same reason `checkedDayIds` above is
	// state and not a derived read of `values.workUnitIds`. Same
	// invalidateAll reasoning applies: these are choices being made for an
	// invoice that does not exist yet, not a mirror of anything committed.
	let documentType = $state(values.documentType);
	let correctsInvoiceId = $state(values.correctsInvoiceId);
	let manualLineDescription = $state(values.manualLineDescription);
	let manualLineAmount = $state(values.manualLineAmount);

	function selectCorrectsInvoice(id: string) {
		correctsInvoiceId = id;
		const original = data.correctableInvoices.find((invoiceRow) => invoiceRow.id === id);
		if (!original) return;
		manualLineDescription = m.invoice_form_credit_note_default_description({
			number: original.number
		});
		manualLineAmount = minorUnitsToDecimalString(original.taxableAmount, original.currency);
	}

	function toggleDay(id: string, checked: boolean) {
		checkedDayIds = checked ? [...checkedDayIds, id] : checkedDayIds.filter((x) => x !== id);
	}
	function toggleExpense(id: string, checked: boolean) {
		checkedExpenseIds = checked
			? [...checkedExpenseIds, id]
			: checkedExpenseIds.filter((x) => x !== id);
	}

	const dayTotal = $derived.by(() => {
		const amounts: MinorUnits[] = [];
		for (const day of data.eligibleDays) {
			if (checkedDayIds.includes(day.id) && day.amount !== null) amounts.push(day.amount);
		}
		return sumMinorUnits(amounts);
	});
	const expenseTotal = $derived(
		sumMinorUnits(
			data.eligibleExpenses
				.filter((expense) => checkedExpenseIds.includes(expense.id))
				.map((expense) => expense.amount)
		)
	);
	const runningTotal = $derived(addMinorUnits(dayTotal, expenseTotal));

	const save = submitting();
</script>

<svelte:head><title>{m.invoice_new_page_title()}</title></svelte:head>

<Page crumbs={data.crumbs} title={m.invoice_new_heading()}>
	<form method="GET" class="flex flex-wrap items-end gap-3">
		<label class="flex min-w-0 flex-1 flex-col gap-1 text-sm">
			{m.invoice_form_contract_label()}
			<select name="contractId" class="w-full border px-2 py-1" required>
				<option value="" disabled selected={data.selectedContractId === ''}
					>{m.invoice_form_contract_placeholder()}</option
				>
				{#each data.contracts as contractRow (contractRow.id)}
					<option value={contractRow.id} selected={contractRow.id === data.selectedContractId}
						>{contractRow.client.legalName} — {contractRow.title}</option
					>
				{/each}
			</select>
		</label>
		<button type="submit" class="shrink-0 border px-4 py-1 text-sm"
			>{m.invoice_form_load_contract()}</button
		>
	</form>

	{#if selectedContract}
		<form method="POST" class="mt-6 flex flex-col gap-6" onsubmit={save.onsubmit}>
			<input type="hidden" name="contractId" value={selectedContract.id} />

			<fieldset class="flex flex-col gap-3">
				<legend class="text-sm font-semibold">{m.invoice_form_document_legend()}</legend>
				<label class="flex flex-col gap-1 text-sm">
					{m.invoice_form_number_label()}
					<input name="number" value={values.number} class="border px-2 py-1" required />
					{#if errors.number}<span class="text-xs font-semibold">{errors.number}</span>{/if}
				</label>
				<label class="flex flex-col gap-1 text-sm">
					{m.invoice_form_issue_date_label()}
					<input
						type="date"
						name="issueDate"
						value={values.issueDate}
						class="border px-2 py-1"
						required
					/>
					{#if errors.issueDate}<span class="text-xs font-semibold">{errors.issueDate}</span>{/if}
				</label>
				<label class="flex flex-col gap-1 text-sm">
					{m.invoice_form_document_type_label()}
					<select
						name="documentType"
						class="border px-2 py-1"
						required
						onchange={(event) => (documentType = (event.currentTarget as HTMLSelectElement).value)}
					>
						{#each documentTypes as type (type)}
							<option value={type} selected={documentType === type}
								>{documentTypeLabel(type)}</option
							>
						{/each}
					</select>
				</label>
				{#if documentType === 'credit_note'}
					{#if data.correctableInvoices.length === 0}
						<!--
							#372: a credit note that corrects nothing cannot actually be
							submitted, since the select below would offer only its
							disabled placeholder and `required` already refuses that.
							Naming the reason and pointing at this contract's own
							invoices beats a select the reader cannot get past.
						-->
						<EmptyState
							icon="€"
							title={m.invoice_form_corrects_invoice_label()}
							body={m.invoice_form_no_correctable_invoices()}
						>
							{#snippet actions()}
								<a
									href={resolve('/clients/[id]/contracts/[contractId]', {
										id: selectedContract.clientId,
										contractId: selectedContract.id
									})}
									class="underline">{m.invoice_form_no_correctable_action()}</a
								>
							{/snippet}
						</EmptyState>
					{:else}
						<label class="flex flex-col gap-1 text-sm">
							{m.invoice_form_corrects_invoice_label()}
							<select
								name="correctsInvoiceId"
								class="border px-2 py-1"
								required
								onchange={(event) =>
									selectCorrectsInvoice((event.currentTarget as HTMLSelectElement).value)}
							>
								<option value="" disabled selected={correctsInvoiceId === ''}
									>{m.invoice_form_corrects_invoice_placeholder()}</option
								>
								{#each data.correctableInvoices as original (original.id)}
									<option value={original.id} selected={original.id === correctsInvoiceId}
										>{original.number} — {formatDate(original.issueDate)} — {formatMinorUnits(
											original.total,
											original.currency
										)}</option
									>
								{/each}
							</select>
							{#if errors.correctsInvoiceId}
								<span class="text-xs font-semibold">{errors.correctsInvoiceId}</span>
							{/if}
						</label>
					{/if}
				{/if}
				<label class="flex flex-col gap-1 text-sm">
					{m.invoice_form_currency_label()}
					<input
						name="currency"
						value={values.currency}
						maxlength="3"
						class="border px-2 py-1 uppercase"
						required
					/>
					{#if errors.currency}<span class="text-xs font-semibold">{errors.currency}</span>{/if}
				</label>
				<label class="flex flex-col gap-1 text-sm">
					{m.invoice_form_due_date_label()}
					<input type="date" name="dueDate" value={values.dueDate} class="border px-2 py-1" />
					<span class="text-xs opacity-70">{m.invoice_form_due_date_hint()}</span>
				</label>
			</fieldset>

			<fieldset class="flex flex-col gap-3">
				<legend class="text-sm font-semibold">{m.invoice_form_extra_legend()}</legend>
				<label class="flex flex-col gap-1 text-sm">
					{m.invoice_form_payment_method_label()}
					<input name="paymentMethod" value={values.paymentMethod} class="border px-2 py-1" />
				</label>
				<label class="flex flex-col gap-1 text-sm">
					{m.invoice_form_iban_label()}
					<input name="iban" value={values.iban} class="border px-2 py-1" />
				</label>
				<label class="flex flex-col gap-1 text-sm">
					{m.invoice_form_transmission_id_label()}
					<input name="transmissionId" value={values.transmissionId} class="border px-2 py-1" />
				</label>
			</fieldset>

			{#if errors.lines}
				<p class="text-xs font-semibold">{errors.lines}</p>
			{/if}

			<fieldset class="flex flex-col gap-3">
				<legend class="text-sm font-semibold">{m.invoice_form_days_legend()}</legend>
				{#if data.eligibleDays.length > 0}
					<p class="text-xs opacity-70">{m.invoice_form_days_hint()}</p>
					{#if errors.workUnitIds}
						<p class="text-xs font-semibold">{errors.workUnitIds}</p>
					{/if}
					<ul class="flex flex-col gap-1">
						{#each data.eligibleDays as day (day.id)}
							<li class="flex items-center justify-between gap-3 border-b py-1">
								<Checkbox
									name="workUnitIds"
									value={day.id}
									checked={checkedDayIds.includes(day.id)}
									disabled={day.amount === null}
									label={`${formatDate(day.date)} — ${day.scope}`}
									onchange={(event) =>
										toggleDay(day.id, (event.currentTarget as HTMLInputElement).checked)}
								/>
								{#if day.amount !== null}
									<Amount
										minorUnits={day.amount}
										currency={selectedContract.currency}
										size="inline"
									/>
								{:else}
									<span class="text-xs opacity-70">{m.invoice_form_day_unpriced()}</span>
								{/if}
							</li>
						{/each}
					</ul>
				{:else if data.daysAllIneligible}
					<!--
						#372: a fresh contract and a contract with three
						worked_without_approval days both land here with an empty
						eligibleDays list, but only the first is fixed by recording a
						day. The second already has days; they are just none of the
						two states listEligibleWorkUnitsForInvoicing
						(work-unit.ts:319) bills from ('worked'/'disputed', with no
						line yet). Sending that reader back to the entry form they
						already used would be a second wrong turn, so this branch
						names the condition instead and offers no action.
					-->
					<EmptyState
						icon="▦"
						title={m.invoice_form_days_legend()}
						body={m.invoice_form_days_all_ineligible()}
					/>
				{:else}
					<EmptyState
						icon="▦"
						title={m.invoice_form_days_legend()}
						body={m.invoice_form_no_eligible_days()}
					>
						{#snippet actions()}
							<!--
								A `Button` with `href` rather than a bare `<a>`, the same shape
								the contract page uses for this exact link:
								`svelte/no-navigation-without-resolve` reads a native `href`
								statically and cannot see that `recordDayHref` is built from
								`resolve()`. The path does go through it.
							-->
							<Button href={recordDayHref} variant="secondary" size="sm">
								{m.invoice_form_no_days_action()}
							</Button>
						{/snippet}
					</EmptyState>
				{/if}
			</fieldset>

			<fieldset class="flex flex-col gap-3">
				<legend class="text-sm font-semibold">{m.invoice_form_expenses_legend()}</legend>
				{#if data.eligibleExpenses.length > 0}
					<p class="text-xs opacity-70">{m.invoice_form_expenses_hint()}</p>
					{#if errors.expenseIds}
						<p class="text-xs font-semibold">{errors.expenseIds}</p>
					{/if}
					<ul class="flex flex-col gap-1">
						{#each data.eligibleExpenses as expense (expense.id)}
							<li class="flex items-center justify-between gap-3 border-b py-1">
								<Checkbox
									name="expenseIds"
									value={expense.id}
									checked={checkedExpenseIds.includes(expense.id)}
									label={`${formatDate(expense.date)} — ${expense.description}`}
									onchange={(event) =>
										toggleExpense(expense.id, (event.currentTarget as HTMLInputElement).checked)}
								/>
								<Amount
									minorUnits={expense.amount}
									currency={selectedContract.currency}
									size="inline"
								/>
							</li>
						{/each}
					</ul>
				{:else}
					<EmptyState
						icon="▧"
						title={m.invoice_form_expenses_legend()}
						body={m.invoice_form_no_eligible_expenses()}
					>
						{#snippet actions()}
							<a
								href={resolve('/clients/[id]/contracts/[contractId]/expenses/new', {
									id: selectedContract.clientId,
									contractId: selectedContract.id
								})}
								class="underline">{m.invoice_form_no_expenses_action()}</a
							>
						{/snippet}
					</EmptyState>
				{/if}
			</fieldset>

			<p class="text-sm font-semibold">
				{m.invoice_form_running_total_label()}
				<Amount minorUnits={runningTotal} currency={selectedContract.currency} size="inline" />
			</p>

			<fieldset class="flex flex-col gap-3">
				<legend class="text-sm font-semibold">{m.invoice_form_manual_line_legend()}</legend>
				<p class="text-xs opacity-70">{m.invoice_form_manual_line_hint()}</p>
				<Field
					label={m.invoice_form_manual_line_description_label()}
					error={errors.manualLineDescription}
					id="manualLineDescription"
				>
					<Input name="manualLineDescription" value={manualLineDescription} />
				</Field>
				<AmountInput
					label={m.invoice_form_manual_line_amount_label()}
					name="manualLineAmount"
					value={manualLineAmount}
					currency={selectedContract.currency}
					error={errors.manualLineAmount}
				/>
			</fieldset>

			<fieldset class="flex flex-col gap-3">
				<legend class="text-sm font-semibold">{m.invoice_form_tax_legend()}</legend>
				{#if data.taxPreview.source === 'pack'}
					<p class="text-xs opacity-70">{m.invoice_form_tax_resolved_hint()}</p>
					<p class="text-sm">
						{#if data.taxPreview.treatmentCode}
							{data.taxPreview.treatmentCode} — {formatPercent(data.taxPreview.taxRate / 100)}
						{:else}
							{m.invoice_form_tax_treatment_none()} — {formatPercent(data.taxPreview.taxRate / 100)}
						{/if}
					</p>
					{#if data.taxPreview.statutoryReference}
						<p class="text-sm"><LegalText value={data.taxPreview.statutoryReference} /></p>
					{/if}
					<p class="text-xs opacity-70">{m.invoice_form_charges_hint()}</p>
				{:else}
					<p class="text-xs opacity-70">{m.invoice_form_tax_manual_hint()}</p>
					<Field label={m.invoice_form_tax_treatment_code_label()} id="taxTreatmentCode">
						<Input name="taxTreatmentCode" value={values.taxTreatmentCode} />
					</Field>
					<Field
						label={m.invoice_form_statutory_reference_language_label()}
						error={errors.statutoryReferenceLanguage}
						id="statutoryReferenceLanguage"
					>
						<Input
							name="statutoryReferenceLanguage"
							value={values.statutoryReferenceLanguage}
							maxlength={2}
						/>
					</Field>
					<Field
						label={m.invoice_form_statutory_reference_text_label()}
						id="statutoryReferenceText"
					>
						<Input name="statutoryReferenceText" value={values.statutoryReferenceText} />
					</Field>
					<Field label={m.invoice_form_tax_rate_label()} error={errors.taxRate} id="taxRate">
						<Input name="taxRate" value={values.taxRate} numeric />
					</Field>
					<AmountInput
						label={m.invoice_form_stamp_duty_label()}
						name="stampDuty"
						value={values.stampDuty}
						currency={selectedContract.currency}
						error={errors.stampDuty}
					/>
					<AmountInput
						label={m.invoice_form_social_charge_label()}
						name="socialCharge"
						value={values.socialCharge}
						currency={selectedContract.currency}
						error={errors.socialCharge}
					/>
				{/if}
			</fieldset>

			<Button type="submit" variant="primary" loading={save.busy}>{m.invoice_form_submit()}</Button>
		</form>
	{/if}
</Page>
