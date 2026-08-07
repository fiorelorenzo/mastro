<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import { formatAmount, formatDate, formatMinorUnits } from '$lib/i18n/format';
	import LegalText from '$lib/legal/LegalText.svelte';
	import PageHeader from '$lib/nav/PageHeader.svelte';
	import { factLine } from '$lib/nav/crumbs';
	import { ageingStatus } from '../status';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const invoice = $derived(data.invoice);

	// The status word for the subtitle: `ageingStatus` is the same helper
	// the ageing table uses, so a due-in/overdue chip reads identically
	// wherever it appears. `daysLate` stops mattering once the invoice is
	// paid, so paid is its own branch rather than a fourth ageing band.
	const statusLabel = $derived(
		invoice.paidOn ? m.invoice_day_status_paid() : ageingStatus(data.daysLate).label
	);
	const subtitle = $derived(
		factLine([`${invoice.contract.client.legalName} — ${invoice.contract.title}`, statusLabel])
	);

	function dayStateLabel(state: string): string {
		switch (state) {
			case 'invoiced':
				return m.invoice_day_status_invoiced();
			case 'disputed':
				return m.invoice_day_status_disputed();
			default:
				return state;
		}
	}
</script>

<svelte:head><title>{m.invoice_detail_page_title({ number: invoice.number })}</title></svelte:head>

<main class="mx-auto max-w-3xl p-8">
	{#snippet remindAction()}
		<a href={resolve('/invoices/[id]/remind', { id: invoice.id })} class="text-sm underline">
			{m.invoice_detail_remind_link()}
		</a>
	{/snippet}
	<PageHeader
		crumbs={data.crumbs}
		title={invoice.number}
		{subtitle}
		actions={data.overdue ? remindAction : undefined}
	/>

	<dl class="mt-6 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
		<dt class="opacity-70">{m.invoice_detail_issue_date_label()}</dt>
		<dd>{formatDate(invoice.issueDate)}</dd>

		<dt class="opacity-70">{m.invoice_detail_due_date_label()}</dt>
		<dd>
			{formatDate(invoice.dueDate)}
			<span class="opacity-70">
				({invoice.dueDateSource === 'document'
					? m.invoice_detail_due_date_source_document()
					: m.invoice_detail_due_date_source_computed()})
			</span>
		</dd>

		<dt class="opacity-70">{m.invoice_detail_taxable_amount_label()}</dt>
		<dd>{formatAmount(invoice.taxableAmount, invoice.currency)}</dd>

		<dt class="opacity-70">{m.invoice_detail_tax_amount_label()}</dt>
		<dd>{formatAmount(invoice.taxAmount, invoice.currency)}</dd>

		{#if invoice.stampDuty}
			<dt class="opacity-70">{m.invoice_form_stamp_duty_label()}</dt>
			<dd>{formatAmount(invoice.stampDuty, invoice.currency)}</dd>
		{/if}
		{#if invoice.socialCharge}
			<dt class="opacity-70">{m.invoice_form_social_charge_label()}</dt>
			<dd>{formatAmount(invoice.socialCharge, invoice.currency)}</dd>
		{/if}

		<dt class="opacity-70">{m.invoice_detail_total_label()}</dt>
		<dd class="font-semibold">{formatAmount(invoice.total, invoice.currency)}</dd>

		{#if invoice.taxTreatmentCode}
			<dt class="opacity-70">{m.invoice_form_tax_treatment_code_label()}</dt>
			<dd>{invoice.taxTreatmentCode}</dd>
		{/if}
		{#if invoice.statutoryReference}
			<dt class="opacity-70">{m.invoice_mandatory_annotation_label()}</dt>
			<dd><LegalText value={invoice.statutoryReference} /></dd>
		{/if}
		{#if invoice.paymentMethod}
			<dt class="opacity-70">{m.invoice_form_payment_method_label()}</dt>
			<dd>{invoice.paymentMethod}</dd>
		{/if}
		{#if invoice.iban}
			<dt class="opacity-70">{m.invoice_form_iban_label()}</dt>
			<dd>{invoice.iban}</dd>
		{/if}
	</dl>

	<section class="mt-6">
		<h2 class="text-sm font-semibold">{m.invoice_detail_payment_heading()}</h2>
		{#if invoice.paidOn}
			<p class="text-sm">{m.invoice_detail_paid_on({ date: formatDate(invoice.paidOn) })}</p>
		{:else}
			<details class="mt-2">
				<summary class="cursor-pointer text-sm underline">{m.invoice_mark_paid_toggle()}</summary>
				<form method="POST" action="?/pay" class="mt-2 flex items-end gap-3">
					<label class="flex flex-col gap-1 text-sm">
						{m.invoice_paid_on_label()}
						<input type="date" name="paidOn" value={data.today} class="border px-2 py-1" required />
					</label>
					<button type="submit" class="border px-4 py-1 text-sm"
						>{m.invoice_mark_paid_submit()}</button
					>
				</form>
				{#if form?.payError}<span class="text-xs font-semibold">{form.payError}</span>{/if}
			</details>
		{/if}
	</section>

	<section class="mt-6">
		<h2 class="text-sm font-semibold">{m.invoice_detail_lines_heading()}</h2>
		<table class="mt-2 w-full border-collapse text-sm">
			<thead>
				<tr class="border-b text-left">
					<th class="py-2 pr-4">{m.invoice_form_line_description_label()}</th>
					<th class="py-2 pr-4 text-end">{m.invoice_form_line_quantity_label()}</th>
					<th class="py-2 pr-4 text-end">{m.invoice_form_line_unit_price_label()}</th>
					<th class="py-2 pr-4 text-end">{m.invoice_form_line_amount_label()}</th>
					<th class="py-2 text-end">{m.invoice_form_line_tax_rate_label()}</th>
				</tr>
			</thead>
			<tbody>
				{#each invoice.lines as line (line.id)}
					<tr class="border-b">
						<td class="py-2 pr-4">{line.description}</td>
						<td class="py-2 pr-4 text-end">{line.quantity}</td>
						<td class="py-2 pr-4 text-end">{formatAmount(line.unitPrice, invoice.currency)}</td>
						<td class="py-2 pr-4 text-end">{formatAmount(line.amount, invoice.currency)}</td>
						<td class="py-2 text-end">{line.taxRate}%</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</section>

	<section id="days" class="mt-6">
		<h2 class="text-sm font-semibold">{m.invoice_detail_days_heading()}</h2>
		{#if invoice.lines.every((line) => line.days.length === 0)}
			<p class="mt-2 text-sm opacity-70">{m.invoice_detail_no_days()}</p>
		{:else}
			<table class="mt-2 w-full border-collapse text-sm">
				<thead>
					<tr class="border-b text-left">
						<th class="py-2 pr-4">{m.invoice_detail_day_date_label()}</th>
						<th class="py-2 pr-4">{m.invoice_detail_day_scope_label()}</th>
						<th class="py-2">{m.invoices_column_status()}</th>
					</tr>
				</thead>
				<tbody>
					{#each invoice.lines as line (line.id)}
						{#each line.days as day (day.id)}
							<tr class="border-b">
								<td class="py-2 pr-4">{formatDate(day.date)}</td>
								<td class="py-2 pr-4">{day.scope}</td>
								<td class="py-2"
									>{invoice.paidOn ? m.invoice_day_status_paid() : dayStateLabel(day.state)}</td
								>
							</tr>
						{/each}
					{/each}
				</tbody>
			</table>
		{/if}
	</section>

	<section id="expenses" class="mt-6">
		<h2 class="text-sm font-semibold">{m.invoice_detail_expenses_heading()}</h2>
		{#if invoice.lines.every((line) => line.expenses.length === 0)}
			<p class="mt-2 text-sm opacity-70">{m.invoice_detail_no_expenses()}</p>
		{:else}
			<table class="mt-2 w-full border-collapse text-sm">
				<thead>
					<tr class="border-b text-left">
						<th class="py-2 pr-4">{m.expense_column_date()}</th>
						<th class="py-2 pr-4">{m.expense_column_description()}</th>
						<th class="py-2">{m.expense_column_amount()}</th>
					</tr>
				</thead>
				<tbody>
					{#each invoice.lines as line (line.id)}
						{#each line.expenses as expenseRow (expenseRow.id)}
							<tr class="border-b">
								<td class="py-2 pr-4">{formatDate(expenseRow.date)}</td>
								<td class="py-2 pr-4">{expenseRow.description}</td>
								<td class="py-2">{formatMinorUnits(expenseRow.amount, invoice.currency)}</td>
							</tr>
						{/each}
					{/each}
				</tbody>
			</table>
		{/if}
	</section>
</main>
