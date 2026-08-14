<script lang="ts">
	// #43/#46/#47: folder scan, client matching, and the review-and-confirm
	// screen. Extended by #44 (dedup against history, conflicts, structured
	// document plus attachment) and #48 (day-mapping proposal). Everything
	// here is client-driven — the folder pick and the recursive walk
	// (`$lib/import/scan.ts`) only exist in the browser — so this route has
	// no `+page.server.ts`; the auth guard in `hooks.server.ts` still
	// protects the initial navigation the same way it protects every other
	// route, since it runs before any page (with or without server data) is
	// served.
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import { formatDate, formatMinorUnits, formatNumber } from '$lib/i18n/format';
	import { Banner, Button, Field, FileInput, Tabs } from '$lib/design';
	import Page from '$lib/layout/Page.svelte';
	import {
		scanDirectoryHandle,
		scanFileList,
		type ScanDirectoryHandle,
		type ScannedFile,
		type ScanProgress
	} from '$lib/import/scan';
	import { invoicingCadenceLabel, invoicingCadences } from './invoicing-cadence';
	import { skipReasonLabel } from './skip-reason';
	import type {
		ClarificationGroup,
		ConfirmResponse,
		InvoiceLineView,
		RecognisedFile,
		ReviewResult
	} from './types';

	type Stage = 'idle' | 'scanning' | 'analyzing' | 'review' | 'confirming' | 'done' | 'error';
	type EditableClarification = ClarificationGroup & { include: boolean };
	// `accepted` defaults to whether a day-mapping proposal exists at all
	// (#48): a line with none never had anything to accept, and a line with
	// one starts accepted, but stays a reviewer's decision to uncheck before
	// confirming — never applied silently.
	type EditableLine = InvoiceLineView & { accepted: boolean };
	type EditableRecognised = Omit<RecognisedFile, 'lines'> & { lines: EditableLine[] };

	let stage = $state<Stage>('idle');
	let scanProgress = $state<ScanProgress | null>(null);
	// Kept for `confirmImport`: writing an invoice needs the file's own
	// bytes again, and re-scanning the folder a second time would defeat
	// the point of a review screen the reviewer can take their time on.
	let scannedFiles = $state<ScannedFile[]>([]);
	let review = $state<ReviewResult | null>(null);
	let clarifications = $state<EditableClarification[]>([]);
	let recognisedFiles = $state<EditableRecognised[]>([]);
	let confirmResult = $state<ConfirmResponse | null>(null);
	let errorText = $state('');

	const supportsDirectoryPicker =
		typeof window !== 'undefined' &&
		typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker ===
			'function';

	const tabs = [
		{ href: resolve('/import'), label: m.import_tab_invoices(), selected: true },
		{ href: resolve('/import/days'), label: m.import_tab_days(), selected: false }
	];

	const acceptedClarificationCount = $derived(
		clarifications.filter((group) => group.include).length
	);
	const hasWorkToConfirm = $derived(acceptedClarificationCount > 0 || recognisedFiles.length > 0);

	function reset(): void {
		stage = 'idle';
		scanProgress = null;
		scannedFiles = [];
		review = null;
		clarifications = [];
		recognisedFiles = [];
		confirmResult = null;
		errorText = '';
	}

	function fail(error: unknown): void {
		stage = 'error';
		errorText = error instanceof Error ? error.message : String(error);
	}

	async function analyze(files: readonly ScannedFile[]): Promise<void> {
		stage = 'analyzing';
		scannedFiles = [...files];
		const formData = new FormData();
		for (const file of files) {
			formData.append('file', new Blob([Uint8Array.from(file.content)]), file.path);
		}
		const response = await fetch('/import/analyze', { method: 'POST', body: formData });
		if (!response.ok) {
			fail(new Error(await response.text()));
			return;
		}
		const data = (await response.json()) as ReviewResult;
		review = data;
		clarifications = data.clarifications.map((group) => ({ ...group, include: true }));
		recognisedFiles = data.recognised.map((file) => ({
			...file,
			lines: file.lines.map((line) => ({ ...line, accepted: line.dayMapping !== null }))
		}));
		stage = 'review';
	}

	async function pickFolder(): Promise<void> {
		reset();
		stage = 'scanning';
		try {
			const showDirectoryPicker = (
				window as unknown as { showDirectoryPicker: () => Promise<ScanDirectoryHandle> }
			).showDirectoryPicker;
			const handle = await showDirectoryPicker();
			const files = await scanDirectoryHandle(handle, (progress) => (scanProgress = progress));
			if (files.length === 0) {
				fail(new Error(m.import_empty_scan()));
				return;
			}
			await analyze(files);
		} catch (error) {
			if (error instanceof DOMException && error.name === 'AbortError') {
				stage = 'idle';
				return;
			}
			fail(error);
		}
	}

	async function onFallbackChange(event: Event): Promise<void> {
		const input = event.currentTarget as HTMLInputElement;
		const picked = input.files;
		if (!picked || picked.length === 0) return;
		reset();
		stage = 'scanning';
		try {
			const files = await scanFileList(picked, (progress) => (scanProgress = progress));
			if (files.length === 0) {
				fail(new Error(m.import_empty_scan()));
				return;
			}
			await analyze(files);
		} catch (error) {
			fail(error);
		} finally {
			input.value = '';
		}
	}

	async function confirmImport(): Promise<void> {
		const acceptedClarifications = clarifications.filter((group) => group.include);
		if (acceptedClarifications.length === 0 && recognisedFiles.length === 0) {
			errorText = m.import_confirm_nothing_selected();
			return;
		}
		errorText = '';
		stage = 'confirming';

		const neededFilenames: string[] = [];
		for (const group of acceptedClarifications) {
			for (const file of group.files) neededFilenames.push(file.filename);
		}
		for (const file of recognisedFiles) {
			neededFilenames.push(file.filename, ...file.attachments);
		}

		const formData = new FormData();
		for (const file of scannedFiles) {
			if (!neededFilenames.includes(file.path)) continue;
			formData.append('file', new Blob([Uint8Array.from(file.content)]), file.path);
		}
		formData.append(
			'decisions',
			JSON.stringify({
				proposals: acceptedClarifications.map((group) => ({
					groupKey: group.groupKey,
					client: group.client,
					contract: group.contract,
					files: group.files.map((file) => ({
						filename: file.filename,
						invoiceIndex: file.invoiceIndex
					}))
				})),
				invoices: recognisedFiles.map((file) => ({
					filename: file.filename,
					invoiceIndex: file.invoiceIndex,
					contractId: file.contractId,
					attachments: file.attachments,
					lineWorkUnitIds: file.lines.map((line) =>
						line.accepted && line.dayMapping ? line.dayMapping.workUnitIds : []
					)
				}))
			})
		);

		const response = await fetch('/import/confirm', { method: 'POST', body: formData });
		if (!response.ok) {
			errorText = await response.text();
			stage = 'review';
			return;
		}
		confirmResult = (await response.json()) as ConfirmResponse;
		stage = 'done';
	}
</script>

<svelte:head><title>{m.import_page_title()}</title></svelte:head>

<Page title={m.import_heading()}>
	<Tabs label={m.import_tabs_label()} {tabs} />
	<p class="mt-2 text-sm opacity-70">{m.import_intro()}</p>

	{#if stage === 'idle' || stage === 'error'}
		<div class="mt-6 flex flex-col items-start gap-3">
			{#if supportsDirectoryPicker}
				<Button variant="secondary" onclick={pickFolder}>
					{m.import_pick_folder_button()}
				</Button>
			{/if}
			<Field label={m.import_fallback_label()}>
				<FileInput
					label={m.import_fallback_button()}
					multiple
					webkitdirectory
					onchange={onFallbackChange}
				/>
			</Field>
			{#if stage === 'error'}
				<Banner tone="critical">{errorText}</Banner>
			{/if}
		</div>
	{:else if stage === 'scanning'}
		<p class="mt-6 text-sm" role="status">
			{m.import_scan_progress({
				filesVisited: formatNumber(scanProgress?.filesVisited ?? 0),
				filesProduced: formatNumber(scanProgress?.filesProduced ?? 0)
			})}
		</p>
	{:else if stage === 'analyzing'}
		<p class="mt-6 text-sm" role="status">
			{m.import_analyzing({ count: formatNumber(scanProgress?.filesProduced ?? 0) })}
		</p>
	{:else if (stage === 'review' || stage === 'confirming') && review}
		<div class="mt-6 flex flex-col gap-8">
			<div class="flex flex-wrap gap-4 text-sm font-semibold">
				<span>{m.import_summary_recognised({ count: formatNumber(recognisedFiles.length) })}</span>
				<span
					>{m.import_summary_already_present({
						count: formatNumber(review.alreadyPresent.length)
					})}</span
				>
				<span>{m.import_summary_conflicts({ count: formatNumber(review.conflicts.length) })}</span>
				<span
					>{m.import_summary_to_clarify({
						count: formatNumber(clarifications.reduce((sum, g) => sum + g.files.length, 0))
					})}</span
				>
			</div>

			{#if errorText}<p class="text-xs font-semibold" role="alert">{errorText}</p>{/if}

			<section>
				<h2 class="text-lg font-semibold">{m.import_section_recognised_heading()}</h2>
				{#if recognisedFiles.length === 0}
					<p class="mt-2 text-sm opacity-70">{m.import_recognised_empty()}</p>
				{:else}
					<div class="mt-2 flex flex-col gap-4">
						{#each recognisedFiles as file (file.filename + ':' + file.invoiceIndex)}
							<div class="flex flex-col gap-2 border p-4 text-sm">
								<div class="flex flex-wrap items-baseline justify-between gap-2">
									<p class="font-semibold">
										{file.invoice.number} — {formatDate(file.invoice.issueDate)}
									</p>
									<p>{formatMinorUnits(file.invoice.total, file.invoice.currency)}</p>
								</div>
								<p class="text-xs opacity-70">{file.filename} · {file.clientLegalName}</p>
								{#if file.attachments.length > 0}
									<p class="text-xs opacity-70">
										{m.import_recognised_attachments({ files: file.attachments.join(', ') })}
									</p>
								{/if}
								{#each file.lines as line, index (index)}
									<div class="border-t pt-2">
										<p>
											{line.description} — {formatMinorUnits(line.amount, file.invoice.currency)}
										</p>
										{#if line.dayMapping}
											<label class="mt-1 flex items-start gap-2 text-xs">
												<input type="checkbox" bind:checked={line.accepted} class="mt-0.5" />
												<span>
													{m.import_day_mapping_proposal({
														count: formatNumber(line.dayMapping.dayCount),
														periodStart: formatDate(line.dayMapping.periodStart),
														periodEnd: formatDate(line.dayMapping.periodEnd),
														amount: formatMinorUnits(
															line.dayMapping.proposedAmount,
															file.invoice.currency
														)
													})}
													{#if !line.dayMapping.amountMatches}
														<strong class="block">
															{m.import_day_mapping_amount_mismatch({
																lineAmount: formatMinorUnits(
																	line.dayMapping.lineAmount,
																	file.invoice.currency
																)
															})}
														</strong>
													{/if}
												</span>
											</label>
										{/if}
									</div>
								{/each}
							</div>
						{/each}
					</div>
				{/if}
			</section>

			<section>
				<h2 class="text-lg font-semibold">{m.import_section_already_present_heading()}</h2>
				<p class="mt-1 text-xs opacity-70">{m.import_already_present_hint()}</p>
				{#if review.alreadyPresent.length === 0}
					<p class="mt-2 text-sm opacity-70">{m.import_already_present_empty()}</p>
				{:else}
					<table class="mt-2 w-full border-collapse text-sm">
						<thead>
							<tr class="border-b text-left">
								<th class="py-2 pr-4">{m.import_column_file()}</th>
								<th class="py-2 pr-4">{m.import_column_invoice()}</th>
								<th class="py-2">{m.import_column_reason()}</th>
							</tr>
						</thead>
						<tbody>
							{#each review.alreadyPresent as row (row.filename + ':' + row.invoiceIndex)}
								<tr class="border-b">
									<td class="py-2 pr-4">{row.filename}</td>
									<td class="py-2 pr-4"
										>{row.invoice.number} — {formatDate(row.invoice.issueDate)}</td
									>
									<td class="py-2">
										{#if row.source === 'batch' && row.duplicateOfFilename}
											{m.import_already_present_duplicate_of({
												duplicateOfFilename: row.duplicateOfFilename
											})}
										{:else if row.existingInvoiceNumber}
											{m.import_already_present_already_imported({
												number: row.existingInvoiceNumber
											})}
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
			</section>

			<section>
				<h2 class="text-lg font-semibold">{m.import_section_conflicts_heading()}</h2>
				<p class="mt-1 text-xs opacity-70">{m.import_conflicts_hint()}</p>
				{#if review.conflicts.length === 0}
					<p class="mt-2 text-sm opacity-70">{m.import_conflicts_empty()}</p>
				{:else}
					<table class="mt-2 w-full border-collapse text-sm">
						<thead>
							<tr class="border-b text-left">
								<th class="py-2 pr-4">{m.import_column_file()}</th>
								<th class="py-2 pr-4">{m.import_column_invoice()}</th>
								<th class="py-2">{m.import_column_reason()}</th>
							</tr>
						</thead>
						<tbody>
							{#each review.conflicts as row (row.filename + ':' + row.invoiceIndex)}
								<tr class="border-b">
									<td class="py-2 pr-4">{row.filename}</td>
									<td class="py-2 pr-4"
										>{row.invoice.number} — {formatDate(row.invoice.issueDate)}</td
									>
									<td class="py-2"
										>{m.import_conflict_existing({
											number: row.existingInvoiceNumber,
											issueDate: formatDate(row.existingIssueDate)
										})}</td
									>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
			</section>

			<section>
				<h2 class="text-lg font-semibold">{m.import_section_clarify_heading()}</h2>
				{#if clarifications.length === 0}
					<p class="mt-2 text-sm opacity-70">{m.import_clarify_empty()}</p>
				{:else}
					<div class="mt-2 flex flex-col gap-4">
						{#each clarifications as group (group.groupKey)}
							<div class="flex flex-col gap-3 border p-4 text-sm">
								<label class="flex items-center gap-2 font-semibold">
									<input type="checkbox" bind:checked={group.include} />
									{m.import_clarify_include_label()}
								</label>

								<p class="text-xs opacity-70">
									{m.import_clarify_files_heading({ count: formatNumber(group.files.length) })}:
									{group.files.map((f) => f.filename).join(', ')}
								</p>
								<p class="text-xs opacity-70">
									{m.import_clarify_observed_amount({
										amount: formatMinorUnits(group.observedRecurringAmount, group.contract.currency)
									})}
								</p>

								<div class="grid grid-cols-2 gap-3">
									<label class="flex flex-col gap-1">
										{m.import_clarify_legal_name_label()}
										<input bind:value={group.client.legalName} class="border px-2 py-1" />
									</label>
									<label class="flex flex-col gap-1">
										{m.import_clarify_tax_id_label()}
										<input bind:value={group.client.taxId} class="border px-2 py-1" />
									</label>
									<label class="flex flex-col gap-1">
										{m.import_clarify_country_label()}
										<input
											bind:value={group.client.country}
											maxlength="2"
											class="border px-2 py-1 uppercase"
										/>
									</label>
									<label class="flex flex-col gap-1">
										{m.import_clarify_address_line1_label()}
										<input bind:value={group.client.addressLine1} class="border px-2 py-1" />
									</label>
									<label class="flex flex-col gap-1">
										{m.import_clarify_address_city_label()}
										<input bind:value={group.client.addressCity} class="border px-2 py-1" />
									</label>
									<label class="flex flex-col gap-1">
										{m.import_clarify_address_postal_code_label()}
										<input bind:value={group.client.addressPostalCode} class="border px-2 py-1" />
									</label>
									<label class="flex flex-col gap-1">
										{m.import_clarify_contract_title_label()}
										<input bind:value={group.contract.title} class="border px-2 py-1" />
									</label>
									<label class="flex flex-col gap-1">
										{m.import_clarify_starts_on_label()}
										<input
											type="date"
											bind:value={group.contract.startsOn}
											class="border px-2 py-1"
										/>
									</label>
									<label class="flex flex-col gap-1">
										{m.import_clarify_payment_terms_days_label()}
										<input
											type="number"
											min="0"
											bind:value={group.contract.paymentTerms.days}
											class="border px-2 py-1"
										/>
									</label>
									<label class="flex flex-col gap-1">
										{m.import_clarify_invoicing_cadence_label()}
										<select bind:value={group.contract.invoicingCadence} class="border px-2 py-1">
											{#each invoicingCadences as cadence (cadence)}
												<option value={cadence}>{invoicingCadenceLabel(cadence)}</option>
											{/each}
										</select>
									</label>
									<label class="flex flex-col gap-1">
										{m.import_clarify_tax_treatment_label()}
										<input bind:value={group.contract.taxTreatment} class="border px-2 py-1" />
										{#if group.contract.taxTreatment.trim() === ''}
											<span class="text-xs font-semibold"
												>{m.import_clarify_tax_treatment_warning()}</span
											>
										{/if}
									</label>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</section>

			<section>
				<h2 class="text-lg font-semibold">{m.import_section_skipped_heading()}</h2>
				{#if review.skipped.length === 0}
					<p class="mt-2 text-sm opacity-70">{m.import_skipped_empty()}</p>
				{:else}
					<table class="mt-2 w-full border-collapse text-sm">
						<thead>
							<tr class="border-b text-left">
								<th class="py-2 pr-4">{m.import_column_file()}</th>
								<th class="py-2">{m.import_column_reason()}</th>
							</tr>
						</thead>
						<tbody>
							{#each review.skipped as row (row.filename + ':' + row.invoiceIndex)}
								<tr class="border-b">
									<td class="py-2 pr-4">{row.filename}</td>
									<td class="py-2">{skipReasonLabel(row.reason)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
			</section>

			<button
				type="button"
				class="w-fit border px-4 py-2 text-sm"
				disabled={stage === 'confirming' || !hasWorkToConfirm}
				onclick={confirmImport}
			>
				{stage === 'confirming' ? m.import_confirming() : m.import_confirm_button()}
			</button>
		</div>
	{:else if stage === 'done' && confirmResult}
		<div class="mt-6 flex flex-col gap-3">
			<p class="text-sm">
				{m.import_confirm_summary({
					clientCount: formatNumber(confirmResult.created.length),
					contractCount: formatNumber(confirmResult.created.length)
				})}
			</p>
			<p class="text-sm">
				{m.import_confirm_invoice_summary({
					createdCount: formatNumber(confirmResult.invoicesCreated.length),
					alreadyPresentCount: formatNumber(confirmResult.invoicesAlreadyPresent.length),
					conflictCount: formatNumber(confirmResult.invoicesConflicted.length)
				})}
			</p>
			{#if confirmResult.failed.length > 0}
				<div class="text-sm">
					<p class="font-semibold">
						{m.import_confirm_partial_failure({ count: formatNumber(confirmResult.failed.length) })}
					</p>
					<ul class="list-disc pl-5">
						{#each confirmResult.failed as failure (failure.groupKey)}
							<li>{failure.groupKey}: {failure.message}</li>
						{/each}
					</ul>
				</div>
			{/if}
			{#if confirmResult.invoicesFailed.length > 0}
				<div class="text-sm">
					<p class="font-semibold">
						{m.import_confirm_invoices_failed({
							count: formatNumber(confirmResult.invoicesFailed.length)
						})}
					</p>
					<ul class="list-disc pl-5">
						{#each confirmResult.invoicesFailed as failure (failure.filename + ':' + failure.invoiceIndex)}
							<li>{failure.filename}: {failure.message}</li>
						{/each}
					</ul>
				</div>
			{/if}
			<button type="button" class="w-fit border px-4 py-2 text-sm" onclick={reset}>
				{m.import_start_over_button()}
			</button>
		</div>
	{/if}
</Page>
