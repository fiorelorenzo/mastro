<!--
	The invoice as a document of record (#239): lines with their days
	underneath so the total reads as a verifiable sum, a headline total,
	a payment block that survives an IBAN at 320px, the archived original,
	the history, and one action whose weight follows the invoice's own
	state — remind when overdue, record payment when merely unpaid,
	nothing shouting once it is paid.
-->
<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import { clientFieldLabel } from '$lib/i18n/client-fields';
	import { appHref } from '$lib/nav/href';
	import { formatDate, formatDays, formatMinorUnits, formatNumber } from '$lib/i18n/format';
	import { minorUnitsToDecimalString } from '$lib/money';
	import LegalText from '$lib/legal/LegalText.svelte';
	import {
		Amount,
		Badge,
		Button,
		Dialog,
		DropZone,
		Field,
		Input,
		SourceDocument,
		Textarea,
		workUnitStateBadge
	} from '$lib/design';
	import Table from '$lib/design/Table.svelte';
	import type { TableColumn } from '$lib/design/table';
	import Page from '$lib/layout/Page.svelte';
	import Section from '$lib/layout/Section.svelte';
	import ChaseHistory from './ChaseHistory.svelte';
	import { invoiceStatus, transmissionStatusBadge } from '../status';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const invoice = $derived(data.invoice);
	const balance = $derived(data.balance);
	const status = $derived(invoiceStatus(data.daysLate, balance.settledOn));
	const transmission = $derived(transmissionStatusBadge(invoice.transmissionStatus));
	const subtitle = $derived(`${invoice.contract.client.legalName} — ${invoice.contract.title}`);
	// The payment form's own amount default: the remaining balance, so
	// the header's one-click action settles the invoice in full, while
	// the field stays freely editable for a partial payment (#212).
	const defaultPaymentAmount = $derived(
		minorUnitsToDecimalString(balance.remaining, invoice.currency)
	);

	type ExpenseRow = PageData['invoice']['lines'][number]['expenses'][number];
	const expenseRows = $derived(invoice.lines.flatMap((line) => line.expenses));

	type PaymentRow = PageData['payments'][number];

	// #214's path in and way back, offered per day row rather than for the
	// whole invoice — a dispute is about one billed day, not the document.
	// Same shared-dialog shape `alerts/+page.svelte`'s `openUnbillableFor`
	// already uses: one dialog for the whole page, not one per row, opened
	// against whichever day's button was clicked. These actions redirect
	// on success (matching every other action on this page), so there is
	// no success toast to wire up — only a failed submit's `form?.…Error`
	// reopens the dialog with what was typed.
	let disputeDialogFor = $state<string | null>(
		form?.disputeError ? (form.workUnitId ?? null) : null
	);
	let disputeReason = $state(form?.reason ?? '');
	let resolveDisputeDialogFor = $state<string | null>(
		form?.resolveDisputeError ? (form.workUnitId ?? null) : null
	);
	let resolveDisputeReason = $state(form?.reason ?? '');
</script>

<svelte:head><title>{m.invoice_detail_page_title({ number: invoice.number })}</title></svelte:head>

{#snippet headerActions()}
	{#if !balance.settled}
		{#if data.overdue}
			<Button href={resolve('/invoices/[id]/remind', { id: invoice.id })} variant="primary">
				{m.invoice_detail_remind_link()}
			</Button>
			<Button type="submit" form="invoice-pay-form" variant="secondary">
				{m.invoice_record_payment_toggle()}
			</Button>
		{:else}
			<Button type="submit" form="invoice-pay-form" variant="primary">
				{m.invoice_record_payment_toggle()}
			</Button>
		{/if}
	{/if}
{/snippet}

{#snippet paymentDateCell(row: PaymentRow)}
	{formatDate(row.date)}
{/snippet}
{#snippet paymentAmountCell(row: PaymentRow)}
	<Amount minorUnits={row.amount} currency={invoice.currency} size="md" />
{/snippet}
{#snippet paymentsEmpty()}
	<p class="table-empty">{m.invoice_payment_history_empty()}</p>
{/snippet}

{#snippet expenseAmountCell(row: ExpenseRow)}
	<Amount minorUnits={row.amount} currency={invoice.currency} size="md" />
{/snippet}
{#snippet expensesEmpty()}
	<p class="table-empty">{m.invoice_detail_no_expenses()}</p>
{/snippet}

<Page crumbs={data.crumbs} title={invoice.number} {subtitle} actions={headerActions}>
	<div class="identity">
		<Badge variant={status.level} label={status.label} />
		<Amount minorUnits={invoice.total} currency={invoice.currency} size="figure" />
	</div>

	<div class="layout">
		<Section title={m.invoice_detail_lines_heading()}>
			<div class="lines-scroll">
				<table class="lines">
					<caption class="sr-only">
						{m.invoice_detail_lines_heading()} — {invoice.number}
					</caption>
					<thead>
						<tr>
							<th scope="col">{m.invoice_form_line_description_label()}</th>
							<th scope="col" class="num">{m.invoice_form_line_quantity_label()}</th>
							<th scope="col" class="num">{m.invoice_form_line_unit_price_label()}</th>
							<th scope="col" class="num">{m.invoice_form_line_amount_label()}</th>
						</tr>
					</thead>
					<tbody>
						{#each invoice.lines as line (line.id)}
							<tr class="line-row">
								<td>{line.description}</td>
								<td class="num">{formatNumber(line.quantity)}</td>
								<td class="num">
									<Amount minorUnits={line.unitPrice} currency={invoice.currency} size="md" />
								</td>
								<td class="num">
									<Amount minorUnits={line.amount} currency={invoice.currency} size="md" />
								</td>
							</tr>
							{#if line.days.length > 0}
								<tr class="group-row">
									<td colspan="4">{m.invoice_detail_line_days_heading()}</td>
								</tr>
								{#each line.days as day (day.id)}
									<tr class="day-row">
										<td class="muted">
											<div class="day-cell">
												<span>{formatDate(day.date)} — {day.scope}</span>
												{#if day.state === 'invoiced'}
													<Button
														type="button"
														variant="tertiary"
														size="sm"
														onclick={() => {
															disputeDialogFor = day.id;
															disputeReason = '';
														}}
													>
														{m.invoice_detail_dispute_button()}
													</Button>
												{:else if day.state === 'disputed'}
													<div class="day-dispute-row">
														<Badge
															variant="serious"
															label={workUnitStateBadge('disputed').label}
															size="sm"
														/>
														<Button
															type="button"
															variant="tertiary"
															size="sm"
															onclick={() => {
																resolveDisputeDialogFor = day.id;
																resolveDisputeReason = '';
															}}
														>
															{m.invoice_detail_resolve_dispute_button()}
														</Button>
														<Button
															href={resolve('/day/[id]/evidence', { id: day.id })}
															variant="tertiary"
															size="sm"
														>
															{m.invoice_detail_evidence_bundle_link()}
														</Button>
													</div>
												{/if}
											</div>
										</td>
										<td class="num muted">{formatNumber(Number(day.quantity))}</td>
										<td class="num muted">
											<Amount minorUnits={line.unitPrice} currency={invoice.currency} size="md" />
										</td>
										<td class="num muted">
											{#if day.amount !== null}
												<Amount minorUnits={day.amount} currency={invoice.currency} size="md" />
											{:else}
												—
											{/if}
										</td>
									</tr>
								{/each}
							{/if}
						{/each}
					</tbody>
					<tfoot>
						<tr>
							<td colspan="3">{m.invoice_detail_taxable_amount_label()}</td>
							<td class="num">
								<Amount minorUnits={invoice.taxableAmount} currency={invoice.currency} size="md" />
							</td>
						</tr>
						<tr>
							<td colspan="3">{m.invoice_detail_tax_amount_label()}</td>
							<td class="num">
								<Amount minorUnits={invoice.taxAmount} currency={invoice.currency} size="md" />
							</td>
						</tr>
						{#if invoice.stampDuty}
							<tr>
								<td colspan="3">{m.invoice_form_stamp_duty_label()}</td>
								<td class="num">
									<Amount minorUnits={invoice.stampDuty} currency={invoice.currency} size="md" />
								</td>
							</tr>
						{/if}
						{#if invoice.socialCharge}
							<tr>
								<td colspan="3">{m.invoice_form_social_charge_label()}</td>
								<td class="num">
									<Amount minorUnits={invoice.socialCharge} currency={invoice.currency} size="md" />
								</td>
							</tr>
						{/if}
						<tr class="total-row">
							<td colspan="3">{m.invoice_detail_total_label()}</td>
							<td class="num">
								<Amount minorUnits={invoice.total} currency={invoice.currency} size="md" />
							</td>
						</tr>
					</tfoot>
				</table>
			</div>

			<form method="POST" action="?/dispute">
				<input type="hidden" name="workUnitId" value={disputeDialogFor ?? ''} />
				<Dialog
					bind:open={
						() => disputeDialogFor !== null,
						(value) => {
							if (!value) disputeDialogFor = null;
						}
					}
					title={m.invoice_detail_dispute_confirm_title()}
					role="alertdialog"
				>
					<p>{m.invoice_detail_dispute_confirm_body()}</p>
					<Field label={m.invoice_detail_dispute_reason_label()} error={form?.disputeError}>
						<Textarea name="reason" bind:value={disputeReason} rows={3} required />
					</Field>
					{#snippet actions()}
						<Button
							type="button"
							variant="tertiary"
							onclick={() => {
								disputeDialogFor = null;
							}}
						>
							{m.invoice_detail_dispute_confirm_cancel()}
						</Button>
						<Button type="submit" variant="primary">
							{m.invoice_detail_dispute_confirm_confirm()}
						</Button>
					{/snippet}
				</Dialog>
			</form>

			<form method="POST" action="?/resolveDispute">
				<input type="hidden" name="workUnitId" value={resolveDisputeDialogFor ?? ''} />
				<Dialog
					bind:open={
						() => resolveDisputeDialogFor !== null,
						(value) => {
							if (!value) resolveDisputeDialogFor = null;
						}
					}
					title={m.invoice_detail_resolve_dispute_confirm_title()}
					role="alertdialog"
				>
					<p>{m.invoice_detail_resolve_dispute_confirm_body()}</p>
					<Field
						label={m.invoice_detail_resolve_dispute_reason_label()}
						error={form?.resolveDisputeError}
					>
						<Textarea name="reason" bind:value={resolveDisputeReason} rows={3} required />
					</Field>
					{#snippet actions()}
						<Button
							type="button"
							variant="tertiary"
							onclick={() => {
								resolveDisputeDialogFor = null;
							}}
						>
							{m.invoice_detail_resolve_dispute_confirm_cancel()}
						</Button>
						<Button type="submit" variant="primary">
							{m.invoice_detail_resolve_dispute_confirm_confirm()}
						</Button>
					{/snippet}
				</Dialog>
			</form>
			{#if invoice.taxTreatmentCode || invoice.statutoryReference || data.routing}
				<div class="fiscal-note">
					{#if invoice.taxTreatmentCode}
						<p>
							<span class="label">{m.invoice_form_tax_treatment_code_label()}</span>
							{invoice.taxTreatmentCode}
						</p>
					{/if}
					{#if invoice.statutoryReference}
						<p>
							<span class="label">{m.invoice_mandatory_annotation_label()}</span>
							<LegalText value={invoice.statutoryReference} />
						</p>
					{/if}
					{#if data.routing}
						<p>
							<span class="label">{m.invoice_detail_routing_label()}</span>
							{#if data.routing.case === 'sdi_code'}
								{m.invoice_detail_routing_sdi_code({ code: data.routing.sdiCode })}
							{:else if data.routing.case === 'pec'}
								{m.invoice_detail_routing_pec({ address: data.routing.pecAddress })}
							{:else}
								{m.invoice_detail_routing_reserved_area()}
							{/if}
						</p>
					{/if}
				</div>
			{/if}
		</Section>

		<div class="stack">
			<Section title={m.invoice_detail_payment_heading()}>
				{#if balance.settled}
					{#if balance.settledOn}
						<p class="paid-note">
							{m.invoice_detail_paid_on({ date: formatDate(balance.settledOn) })}
						</p>
					{/if}
					{#if balance.paid > invoice.total}
						<p class="hint">
							{m.invoice_detail_overpaid_note({
								amount: formatMinorUnits(balance.paid, invoice.currency)
							})}
						</p>
					{/if}
				{:else}
					<dl
						class="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm [&_dd]:min-w-0 [&_dd]:break-words"
					>
						<dt class="opacity-70">{m.invoice_detail_due_date_label()}</dt>
						<dd>
							{formatDate(invoice.dueDate)}
							{#if invoice.dueDateSource === 'computed'}
								<span class="hint">— {m.invoice_detail_due_date_source_computed()}</span>
							{/if}
						</dd>
						{#if invoice.paymentMethod}
							<dt class="opacity-70">{m.invoice_form_payment_method_label()}</dt>
							<dd>{invoice.paymentMethod}</dd>
						{/if}
						{#if invoice.iban}
							<dt class="opacity-70">{m.invoice_form_iban_label()}</dt>
							<dd class="mono">{invoice.iban}</dd>
						{/if}
						{#if balance.paid > 0}
							<dt class="opacity-70">{m.invoice_detail_received_label()}</dt>
							<dd><Amount minorUnits={balance.paid} currency={invoice.currency} size="md" /></dd>
							<dt class="opacity-70">{m.invoice_detail_remaining_label()}</dt>
							<dd>
								<Amount minorUnits={balance.remaining} currency={invoice.currency} size="md" />
							</dd>
						{/if}
					</dl>
					<form id="invoice-pay-form" method="POST" action="?/pay" class="pay-form">
						<Field label={m.invoice_payment_amount_label()} required>
							<Input
								type="number"
								step="0.01"
								min="0.01"
								name="amount"
								value={defaultPaymentAmount}
								numeric
								required
							/>
						</Field>
						<Field label={m.invoice_payment_date_label()} required>
							<Input type="date" name="date" value={data.today} required />
						</Field>
						<Field label={m.invoice_payment_method_label()}>
							<Input type="text" name="method" />
						</Field>
						<Field label={m.invoice_payment_reference_label()}>
							<Input type="text" name="reference" />
						</Field>
						<Button type="submit" variant="tertiary" size="sm">
							{m.invoice_record_payment_submit()}
						</Button>
						{#if form?.payError}<p class="error">{form.payError}</p>{/if}
					</form>
				{/if}

				{#if data.payments.length > 0}
					{@const paymentColumns = [
						{ key: 'date', label: m.invoice_payment_column_date(), cell: paymentDateCell },
						{
							key: 'amount',
							label: m.invoice_payment_column_amount(),
							align: 'end',
							cell: paymentAmountCell
						},
						{
							key: 'method',
							label: m.invoice_payment_column_method(),
							format: (row: PaymentRow) => row.method ?? '—'
						},
						{
							key: 'reference',
							label: m.invoice_payment_column_reference(),
							format: (row: PaymentRow) => row.reference ?? '—'
						}
					] satisfies readonly TableColumn<PaymentRow>[]}
					<Table
						columns={paymentColumns}
						rows={data.payments}
						caption={m.invoice_payment_history_heading()}
						rowKey={(row) => row.id}
						empty={paymentsEmpty}
						density="compact"
					/>
				{/if}
			</Section>

			<Section title={m.invoice_detail_documents_heading()}>
				{#each data.documents as document (document.id)}
					<SourceDocument {document} />
				{:else}
					<SourceDocument document={null} />
				{/each}
				{#if data.routing}
					<form method="POST" action="?/generateFattura" class="fattura-form">
						<Button
							type="submit"
							variant="tertiary"
							size="sm"
							disabled={data.invoicingGaps.length > 0}
						>
							{m.invoice_detail_fattura_generate_button()}
						</Button>
						<!-- Named before the click, not after: the fields live on
						     the client's own screen, so a bare refusal would send
						     a reviewer hunting. -->
						{#if data.invoicingGaps.length > 0}
							<p class="gaps">
								{m.invoice_detail_fattura_client_incomplete({
									fields: data.invoicingGaps.map((field) => clientFieldLabel(field)).join(', ')
								})}
								<a href={appHref(`/clients/${data.invoice.contract.client.id}/edit`)}>
									{m.invoice_detail_fattura_client_fix_link()}
								</a>
							</p>
						{/if}
						{#if form?.fatturaError}<p class="error">{form.fatturaError}</p>{/if}
					</form>
				{/if}
			</Section>

			{#if data.routing}
				<Section title={m.invoice_detail_transmission_heading()}>
					<Badge variant={transmission.variant} label={transmission.label} />

					{#if invoice.transmissionId}
						<p class="hint">
							<span class="label">{m.invoice_form_transmission_id_label()}</span>
							<span class="mono">{invoice.transmissionId}</span>
						</p>
					{/if}

					{#if invoice.transmissionStatus === 'rejected'}
						<p class="hint">{m.invoice_detail_transmission_reject_note()}</p>
					{/if}

					{#if invoice.transmissionStatus === 'generated' || invoice.transmissionStatus === 'rejected'}
						<form method="POST" action="?/markTransmitted" class="fattura-form">
							<Field label={m.invoice_form_transmission_id_label()} required>
								<Input type="text" name="transmissionId" required />
							</Field>
							<Button type="submit" variant="tertiary" size="sm">
								{invoice.transmissionStatus === 'rejected'
									? m.invoice_detail_transmission_resubmit_button()
									: m.invoice_detail_transmit_button()}
							</Button>
							{#if form?.transmissionError}<p class="error">{form.transmissionError}</p>{/if}
						</form>
					{:else if invoice.transmissionStatus === 'transmitted'}
						<form
							method="POST"
							action="?/acceptReceipt"
							enctype="multipart/form-data"
							class="fattura-form"
						>
							<Field label={m.invoice_detail_transmission_accept_file_label()} required>
								<DropZone name="file" label={m.invoice_propose_file_button()} required />
							</Field>
							<Button type="submit" variant="tertiary" size="sm">
								{m.invoice_detail_transmission_accept_button()}
							</Button>
						</form>
						<form
							method="POST"
							action="?/rejectReceipt"
							enctype="multipart/form-data"
							class="fattura-form"
						>
							<Field label={m.invoice_detail_transmission_reject_file_label()} required>
								<DropZone name="file" label={m.invoice_propose_file_button()} required />
							</Field>
							<Button type="submit" variant="danger" size="sm">
								{m.invoice_detail_transmission_reject_button()}
							</Button>
						</form>
						{#if form?.receiptError}<p class="error">{form.receiptError}</p>{/if}
					{/if}
				</Section>
			{/if}

			<Section title={m.invoice_detail_history_heading()}>
				<dl
					class="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm [&_dd]:min-w-0 [&_dd]:break-words"
				>
					<dt class="opacity-70">{m.invoice_detail_issue_date_label()}</dt>
					<dd>{formatDate(invoice.issueDate)}</dd>
					{#if balance.settledOn}
						<dt class="opacity-70">{m.invoice_detail_paid_date_label()}</dt>
						<dd>{formatDate(balance.settledOn)}</dd>
					{:else}
						<dt class="opacity-70">{m.invoice_detail_due_date_label()}</dt>
						<dd>
							{formatDate(invoice.dueDate)}
							{#if data.daysLate > 0}
								— {m.invoice_detail_days_overdue_note({ days: formatDays(data.daysLate) })}
							{/if}
						</dd>
					{/if}
				</dl>
				<ChaseHistory rows={data.chaseHistory} />
			</Section>
		</div>
	</div>

	{@const expenseColumns = [
		{ key: 'date', label: m.expense_column_date(), format: (e: ExpenseRow) => formatDate(e.date) },
		{
			key: 'description',
			label: m.expense_column_description(),
			format: (e: ExpenseRow) => e.description
		},
		{ key: 'amount', label: m.expense_column_amount(), align: 'end', cell: expenseAmountCell }
	] satisfies readonly TableColumn<ExpenseRow>[]}

	<Section title={m.invoice_detail_expenses_heading()}>
		<Table
			columns={expenseColumns}
			rows={expenseRows}
			caption={m.invoice_detail_expenses_heading()}
			rowKey={(row) => row.id}
			empty={expensesEmpty}
		/>
	</Section>
</Page>

<style>
	.identity {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-4);
		margin-top: var(--space-2);
		margin-bottom: var(--space-6);
	}
	.layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-6);
		margin-bottom: var(--space-6);
	}
	/* Grid items default to `min-width: auto`, which refuses to shrink below
	   the lines table's own content width — the exact "grid blowout" that
	   pushed this page 47px past a 320px viewport until `minmax(0, …)`
	   pinned both tracks' minimum to zero and let `.lines-scroll`'s own
	   `overflow-x: auto` do the job it was already there to do. */
	.layout > :global(.section),
	.layout > .stack {
		min-width: 0;
	}
	@media (min-width: 800px) {
		.layout {
			grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
			align-items: start;
		}
	}
	.stack {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}
	.lines-scroll {
		overflow-x: auto;
	}
	.lines {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--text-sm);
	}
	.lines th,
	.lines td {
		padding: var(--space-2) var(--space-3) var(--space-2) 0;
		text-align: start;
		vertical-align: top;
	}
	.lines th {
		color: var(--text-secondary);
		font-weight: var(--weight-medium);
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		border-bottom: 1px solid var(--line-strong);
	}
	.lines td {
		border-bottom: 1px solid var(--line);
	}
	.lines .num {
		text-align: end;
	}
	.lines .muted {
		color: var(--text-secondary);
	}
	.day-cell {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-1);
	}
	.day-dispute-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.lines .group-row td {
		padding-top: var(--space-3);
		font-size: var(--text-xs);
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.03em;
		border-bottom: none;
	}
	.lines tfoot td {
		border-bottom: none;
		border-top: 1px solid var(--line);
	}
	.lines .total-row td {
		font-weight: var(--weight-bold);
		font-size: var(--text-md);
	}
	.fiscal-note {
		margin-top: var(--space-4);
		font-size: var(--text-sm);
		color: var(--text-secondary);
	}
	.fiscal-note p {
		margin: var(--space-1) 0;
	}
	.fiscal-note .label {
		color: var(--text-muted);
		margin-right: var(--space-2);
	}
	.paid-note {
		font-size: var(--text-sm);
	}
	.hint {
		color: var(--text-muted);
		font-size: var(--text-xs);
	}
	.mono {
		font-family: var(--font-mono);
	}
	.pay-form {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: var(--space-3);
		margin-top: var(--space-4);
	}
	.fattura-form {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-2);
		margin-top: var(--space-3);
	}
	.error {
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		color: var(--color-danger);
	}
	.table-empty {
		margin: 0;
		padding: var(--space-2) 0;
		font-size: var(--text-sm);
		font-style: italic;
		color: var(--text-muted);
	}
</style>
