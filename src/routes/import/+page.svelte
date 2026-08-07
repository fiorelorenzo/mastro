<script lang="ts">
	// #43/#46/#47: folder scan, client matching, and the review-and-confirm
	// screen. Everything here is client-driven — the folder pick and the
	// recursive walk (`$lib/import/scan.ts`) only exist in the browser — so
	// this route has no `+page.server.ts`; the auth guard in
	// `hooks.server.ts` still protects the initial navigation the same way
	// it protects every other route, since it runs before any page (with or
	// without server data) is served.
	import * as m from '$lib/paraglide/messages';
	import { formatDate, formatMinorUnits, formatNumber } from '$lib/i18n/format';
	import {
		scanDirectoryHandle,
		scanFileList,
		type ScanDirectoryHandle,
		type ScannedFile,
		type ScanProgress
	} from '$lib/import/scan';
	import { invoicingCadenceLabel, invoicingCadences } from './invoicing-cadence';
	import { skipReasonLabel } from './skip-reason';
	import type { ClarificationGroup, ConfirmResponse, ReviewResult } from './types';

	type Stage = 'idle' | 'scanning' | 'analyzing' | 'review' | 'confirming' | 'done' | 'error';
	type EditableClarification = ClarificationGroup & { include: boolean };

	let stage = $state<Stage>('idle');
	let scanProgress = $state<ScanProgress | null>(null);
	let review = $state<ReviewResult | null>(null);
	let clarifications = $state<EditableClarification[]>([]);
	let confirmResult = $state<ConfirmResponse | null>(null);
	let errorText = $state('');

	const supportsDirectoryPicker =
		typeof window !== 'undefined' &&
		typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker ===
			'function';

	const acceptedCount = $derived(clarifications.filter((group) => group.include).length);

	function reset(): void {
		stage = 'idle';
		scanProgress = null;
		review = null;
		clarifications = [];
		confirmResult = null;
		errorText = '';
	}

	function fail(error: unknown): void {
		stage = 'error';
		errorText = error instanceof Error ? error.message : String(error);
	}

	async function analyze(files: readonly ScannedFile[]): Promise<void> {
		stage = 'analyzing';
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
		const accepted = clarifications.filter((group) => group.include);
		if (accepted.length === 0) {
			errorText = m.import_confirm_nothing_selected();
			return;
		}
		errorText = '';
		stage = 'confirming';
		const response = await fetch('/import/confirm', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				proposals: accepted.map((group) => ({
					groupKey: group.groupKey,
					client: group.client,
					contract: group.contract
				}))
			})
		});
		if (!response.ok) {
			const message = await response.text();
			errorText = message;
			stage = 'review';
			return;
		}
		confirmResult = (await response.json()) as ConfirmResponse;
		stage = 'done';
	}
</script>

<svelte:head><title>{m.import_page_title()}</title></svelte:head>

<main class="mx-auto max-w-3xl p-8">
	<h1 class="text-2xl font-semibold">{m.import_heading()}</h1>
	<p class="mt-2 text-sm opacity-70">{m.import_intro()}</p>

	{#if stage === 'idle' || stage === 'error'}
		<div class="mt-6 flex flex-col items-start gap-3">
			{#if supportsDirectoryPicker}
				<button type="button" class="w-fit border px-4 py-2 text-sm" onclick={pickFolder}>
					{m.import_pick_folder_button()}
				</button>
			{/if}
			<label class="flex flex-col gap-1 text-sm">
				{m.import_fallback_label()}
				<input
					type="file"
					multiple
					webkitdirectory
					class="border px-2 py-1"
					onchange={onFallbackChange}
				/>
			</label>
			{#if stage === 'error'}
				<p class="text-xs font-semibold" role="alert">{errorText}</p>
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
				<span>{m.import_summary_recognised({ count: formatNumber(review.recognised.length) })}</span
				>
				<span
					>{m.import_summary_already_present({
						count: formatNumber(review.alreadyPresent.length)
					})}</span
				>
				<span
					>{m.import_summary_to_clarify({
						count: formatNumber(clarifications.reduce((sum, g) => sum + g.files.length, 0))
					})}</span
				>
			</div>

			{#if errorText}<p class="text-xs font-semibold" role="alert">{errorText}</p>{/if}

			<section>
				<h2 class="text-lg font-semibold">{m.import_section_recognised_heading()}</h2>
				{#if review.recognised.length === 0}
					<p class="mt-2 text-sm opacity-70">{m.import_recognised_empty()}</p>
				{:else}
					<table class="mt-2 w-full border-collapse text-sm">
						<thead>
							<tr class="border-b text-left">
								<th class="py-2 pr-4">{m.import_column_file()}</th>
								<th class="py-2 pr-4">{m.import_column_invoice()}</th>
								<th class="py-2 pr-4">{m.import_column_amount()}</th>
								<th class="py-2">{m.import_column_client()}</th>
							</tr>
						</thead>
						<tbody>
							{#each review.recognised as row (row.filename)}
								<tr class="border-b">
									<td class="py-2 pr-4">{row.filename}</td>
									<td class="py-2 pr-4"
										>{row.invoice.number} — {formatDate(row.invoice.issueDate)}</td
									>
									<td class="py-2 pr-4"
										>{formatMinorUnits(row.invoice.total, row.invoice.currency)}</td
									>
									<td class="py-2">{row.clientLegalName}</td>
								</tr>
							{/each}
						</tbody>
					</table>
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
							{#each review.alreadyPresent as row (row.filename)}
								<tr class="border-b">
									<td class="py-2 pr-4">{row.filename}</td>
									<td class="py-2 pr-4"
										>{row.invoice.number} — {formatDate(row.invoice.issueDate)}</td
									>
									<td class="py-2"
										>{m.import_already_present_duplicate_of({
											duplicateOfFilename: row.duplicateOfFilename
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
							{#each review.skipped as row (row.filename)}
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
				disabled={stage === 'confirming' || acceptedCount === 0}
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
			<button type="button" class="w-fit border px-4 py-2 text-sm" onclick={reset}>
				{m.import_start_over_button()}
			</button>
		</div>
	{/if}
</main>
