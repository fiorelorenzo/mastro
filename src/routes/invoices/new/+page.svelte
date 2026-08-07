<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { formatDate } from '$lib/i18n/format';
	import PageHeader from '$lib/nav/PageHeader.svelte';
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

	const emptyLine = {
		description: '',
		quantity: '',
		unitPrice: '',
		amount: '',
		taxRate: '',
		taxTreatmentCode: '',
		workUnitIds: [] as string[]
	};
	const lineSlots = $derived(
		form?.values.lines ?? [emptyLine, emptyLine, emptyLine, emptyLine, emptyLine, emptyLine]
	);
	const values: InvoiceFormValues = $derived(
		form?.values ?? {
			contractId: data.selectedContractId,
			number: '',
			issueDate: '',
			documentType: 'invoice',
			currency: selectedContract?.currency ?? '',
			taxTreatmentCode: '',
			statutoryReferenceLanguage: '',
			statutoryReferenceText: '',
			stampDuty: '',
			socialCharge: '',
			dueDate: '',
			paymentMethod: '',
			iban: '',
			transmissionId: '',
			lines: []
		}
	);
	const errors: Record<string, string> = $derived(form?.errors ?? {});
</script>

<svelte:head><title>{m.invoice_new_page_title()}</title></svelte:head>

<main class="mx-auto max-w-3xl p-8">
	<PageHeader crumbs={data.crumbs} title={m.invoice_new_heading()} />

	<form method="GET" class="mt-6 flex items-end gap-3">
		<label class="flex flex-col gap-1 text-sm">
			{m.invoice_form_contract_label()}
			<select name="contractId" class="border px-2 py-1" required>
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
		<button type="submit" class="border px-4 py-1 text-sm">{m.invoice_form_load_contract()}</button>
	</form>

	{#if selectedContract}
		<form method="POST" class="mt-6 flex flex-col gap-6">
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
					<select name="documentType" class="border px-2 py-1" required>
						{#each documentTypes as type (type)}
							<option value={type} selected={values.documentType === type}
								>{documentTypeLabel(type)}</option
							>
						{/each}
					</select>
				</label>
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
					{m.invoice_form_tax_treatment_code_label()}
					<input name="taxTreatmentCode" value={values.taxTreatmentCode} class="border px-2 py-1" />
				</label>
				<label class="flex flex-col gap-1 text-sm">
					{m.invoice_form_statutory_reference_language_label()}
					<input
						name="statutoryReferenceLanguage"
						value={values.statutoryReferenceLanguage}
						maxlength="2"
						class="border px-2 py-1"
					/>
					{#if errors.statutoryReferenceLanguage}<span class="text-xs font-semibold"
							>{errors.statutoryReferenceLanguage}</span
						>{/if}
				</label>
				<label class="flex flex-col gap-1 text-sm">
					{m.invoice_form_statutory_reference_text_label()}
					<input
						name="statutoryReferenceText"
						value={values.statutoryReferenceText}
						class="border px-2 py-1"
					/>
				</label>
				<label class="flex flex-col gap-1 text-sm">
					{m.invoice_form_stamp_duty_label()}
					<input name="stampDuty" value={values.stampDuty} class="border px-2 py-1" />
					{#if errors.stampDuty}<span class="text-xs font-semibold">{errors.stampDuty}</span>{/if}
				</label>
				<label class="flex flex-col gap-1 text-sm">
					{m.invoice_form_social_charge_label()}
					<input name="socialCharge" value={values.socialCharge} class="border px-2 py-1" />
					{#if errors.socialCharge}<span class="text-xs font-semibold">{errors.socialCharge}</span
						>{/if}
				</label>
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

			<fieldset class="flex flex-col gap-4">
				<legend class="text-sm font-semibold">{m.invoice_form_lines_legend()}</legend>
				<p class="text-xs opacity-70">{m.invoice_form_lines_hint()}</p>
				{#if errors.lines}<span class="text-xs font-semibold">{errors.lines}</span>{/if}
				<input type="hidden" name="lineCount" value={lineSlots.length} />
				{#each lineSlots as line, i (i)}
					<div class="flex flex-col gap-2 border p-3 text-sm">
						<label class="flex flex-col gap-1">
							{m.invoice_form_line_description_label()}
							<input name="lineDescription_{i}" value={line.description} class="border px-2 py-1" />
							{#if errors[`lineDescription_${i}`]}<span class="text-xs font-semibold"
									>{errors[`lineDescription_${i}`]}</span
								>{/if}
						</label>
						<div class="grid grid-cols-2 gap-2">
							<label class="flex flex-col gap-1">
								{m.invoice_form_line_quantity_label()}
								<input name="lineQuantity_{i}" value={line.quantity} class="border px-2 py-1" />
								{#if errors[`lineQuantity_${i}`]}<span class="text-xs font-semibold"
										>{errors[`lineQuantity_${i}`]}</span
									>{/if}
							</label>
							<label class="flex flex-col gap-1">
								{m.invoice_form_line_unit_price_label()}
								<input name="lineUnitPrice_{i}" value={line.unitPrice} class="border px-2 py-1" />
							</label>
							<label class="flex flex-col gap-1">
								{m.invoice_form_line_amount_label()}
								<input name="lineAmount_{i}" value={line.amount} class="border px-2 py-1" />
								{#if errors[`lineAmount_${i}`]}<span class="text-xs font-semibold"
										>{errors[`lineAmount_${i}`]}</span
									>{/if}
							</label>
							<label class="flex flex-col gap-1">
								{m.invoice_form_line_tax_rate_label()}
								<input name="lineTaxRate_{i}" value={line.taxRate} class="border px-2 py-1" />
								{#if errors[`lineTaxRate_${i}`]}<span class="text-xs font-semibold"
										>{errors[`lineTaxRate_${i}`]}</span
									>{/if}
							</label>
						</div>
						<label class="flex flex-col gap-1">
							{m.invoice_form_line_tax_treatment_code_label()}
							<input
								name="lineTaxTreatmentCode_{i}"
								value={line.taxTreatmentCode}
								class="border px-2 py-1"
							/>
						</label>
						{#if data.eligibleDays.length > 0}
							<fieldset class="flex flex-col gap-1 border p-2">
								<legend class="text-xs font-semibold">{m.invoice_form_line_days_legend()}</legend>
								{#each data.eligibleDays as day (day.id)}
									<label class="flex items-center gap-2 text-xs">
										<input
											type="checkbox"
											name="lineDays_{i}"
											value={day.id}
											checked={line.workUnitIds.includes(day.id)}
										/>
										{formatDate(day.date)} — {day.scope}
									</label>
								{/each}
							</fieldset>
						{:else}
							<p class="text-xs opacity-70">{m.invoice_form_no_eligible_days()}</p>
						{/if}
					</div>
				{/each}
			</fieldset>

			<button type="submit" class="w-fit border px-4 py-2 text-sm">{m.invoice_form_submit()}</button
			>
		</form>
	{/if}
</main>
