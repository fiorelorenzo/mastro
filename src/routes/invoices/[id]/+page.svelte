<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import { formatDate, formatMinorUnits } from '$lib/i18n/format';
	import LegalText from '$lib/legal/LegalText.svelte';
	import SourceDocument from '$lib/design/SourceDocument.svelte';
	import Page from '$lib/layout/Page.svelte';
	import Section from '$lib/layout/Section.svelte';
	import RecordList from '$lib/layout/RecordList.svelte';
	import type { RecordColumn } from '$lib/layout/types';
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

	type LineRow = PageData['invoice']['lines'][number];
	type DayRow = LineRow['days'][number];
	type ExpenseRow = LineRow['expenses'][number];

	const lineColumns: readonly RecordColumn<LineRow>[] = $derived([
		{
			key: 'description',
			label: m.invoice_form_line_description_label(),
			format: (l) => l.description
		},
		{
			key: 'quantity',
			label: m.invoice_form_line_quantity_label(),
			align: 'end',
			format: (l) => String(l.quantity)
		},
		{
			key: 'unitPrice',
			label: m.invoice_form_line_unit_price_label(),
			align: 'end',
			format: (l) => formatMinorUnits(l.unitPrice, invoice.currency)
		},
		{
			key: 'amount',
			label: m.invoice_form_line_amount_label(),
			align: 'end',
			format: (l) => formatMinorUnits(l.amount, invoice.currency)
		},
		{
			key: 'taxRate',
			label: m.invoice_form_line_tax_rate_label(),
			align: 'end',
			format: (l) => `${l.taxRate}%`
		}
	]);

	const dayColumns: readonly RecordColumn<DayRow>[] = $derived([
		{ key: 'date', label: m.invoice_detail_day_date_label(), format: (d) => formatDate(d.date) },
		{ key: 'scope', label: m.invoice_detail_day_scope_label(), format: (d) => d.scope },
		{
			key: 'status',
			label: m.invoices_column_status(),
			format: (d) => (invoice.paidOn ? m.invoice_day_status_paid() : dayStateLabel(d.state))
		}
	]);
	const dayRows = $derived(invoice.lines.flatMap((line) => line.days));

	const expenseColumns: readonly RecordColumn<ExpenseRow>[] = $derived([
		{ key: 'date', label: m.expense_column_date(), format: (e) => formatDate(e.date) },
		{ key: 'description', label: m.expense_column_description(), format: (e) => e.description },
		{
			key: 'amount',
			label: m.expense_column_amount(),
			align: 'end',
			format: (e) => formatMinorUnits(e.amount, invoice.currency)
		}
	]);
	const expenseRows = $derived(invoice.lines.flatMap((line) => line.expenses));
</script>

<svelte:head><title>{m.invoice_detail_page_title({ number: invoice.number })}</title></svelte:head>

{#snippet remindAction()}
	<a href={resolve('/invoices/[id]/remind', { id: invoice.id })} class="underline">
		{m.invoice_detail_remind_link()}
	</a>
{/snippet}

<Page
	crumbs={data.crumbs}
	title={invoice.number}
	{subtitle}
	actions={data.overdue ? remindAction : undefined}
>
	<dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
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
		<dd>{formatMinorUnits(invoice.taxableAmount, invoice.currency)}</dd>

		<dt class="opacity-70">{m.invoice_detail_tax_amount_label()}</dt>
		<dd>{formatMinorUnits(invoice.taxAmount, invoice.currency)}</dd>

		{#if invoice.stampDuty}
			<dt class="opacity-70">{m.invoice_form_stamp_duty_label()}</dt>
			<dd>{formatMinorUnits(invoice.stampDuty, invoice.currency)}</dd>
		{/if}
		{#if invoice.socialCharge}
			<dt class="opacity-70">{m.invoice_form_social_charge_label()}</dt>
			<dd>{formatMinorUnits(invoice.socialCharge, invoice.currency)}</dd>
		{/if}

		<dt class="opacity-70">{m.invoice_detail_total_label()}</dt>
		<dd class="font-semibold">{formatMinorUnits(invoice.total, invoice.currency)}</dd>

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

	<Section title={m.invoice_detail_payment_heading()}>
		{#if invoice.paidOn}
			<p class="text-sm">{m.invoice_detail_paid_on({ date: formatDate(invoice.paidOn) })}</p>
		{:else}
			<details>
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
	</Section>

	<Section title={m.invoice_detail_lines_heading()}>
		<RecordList
			columns={lineColumns}
			rows={invoice.lines}
			caption={m.invoice_detail_lines_heading()}
			rowKey={(line) => line.id}
		/>
	</Section>

	<Section title={m.invoice_detail_days_heading()}>
		{#if dayRows.length === 0}
			<p class="text-sm opacity-70">{m.invoice_detail_no_days()}</p>
		{:else}
			<RecordList
				columns={dayColumns}
				rows={dayRows}
				caption={m.invoice_detail_days_heading()}
				rowKey={(day) => day.id}
			/>
		{/if}
	</Section>

	<Section title={m.invoice_detail_expenses_heading()}>
		{#if expenseRows.length === 0}
			<p class="text-sm opacity-70">{m.invoice_detail_no_expenses()}</p>
		{:else}
			<RecordList
				columns={expenseColumns}
				rows={expenseRows}
				caption={m.invoice_detail_expenses_heading()}
				rowKey={(expenseRow) => expenseRow.id}
			/>
		{/if}
	</Section>

	<Section title={m.invoice_detail_documents_heading()}>
		{#each data.documents as document (document.id)}
			<SourceDocument {document} />
		{:else}
			<SourceDocument document={null} />
		{/each}
	</Section>
</Page>
