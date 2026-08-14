// The dispute evidence bundle (#214) as plain text: every section the
// on-screen page renders, in the same order, written out so it survives
// outside the app. Dates stay raw ISO strings and amounts stay plain
// decimal-plus-currency-code, the same "unambiguous and locale-invariant"
// choice `register/format.ts` already makes for exactly this reason — a
// figure a client might cross-check is never run through a formatter that
// silently depends on who is reading it. Reuses the day detail page's own
// section labels (`day_detail_approval_label` etc.) and the contract
// detail page's own clause-note labels rather than inventing near-
// duplicate strings for the same concepts.
import * as m from '$lib/paraglide/messages';
import { minorUnitsToDecimalString } from '$lib/money';
import type { ContractTemplateLanguage } from '$lib/server/db/schema';
import { formatApprovalReference } from '$lib/server/register/format';
import type { DisputeBundle } from './types';

function section(heading: string, lines: readonly string[]): string[] {
	return [heading, ...lines, ''];
}

/** Renders `bundle` as plain text in `language` — the contract's own
 *  template language (#69's convention, reused here since the same
 *  register entry this bundle carries is rendered in it), never the
 *  operator's active interface locale: this file is meant to leave the
 *  app and be read by whoever is on the other side of the dispute. */
export function renderDisputeBundleSummary(
	bundle: DisputeBundle,
	language: ContractTemplateLanguage
): string {
	const loc = { locale: language } as const;

	const registerLines: string[] = bundle.register.entry
		? [
				`${bundle.register.entry.date} — ${bundle.register.entry.scope} (${bundle.register.entry.quantity})`,
				formatApprovalReference(bundle.register.entry.approval)
			]
		: [m.dispute_bundle_register_empty({}, loc)];
	registerLines.push(
		m.dispute_bundle_register_total({ total: String(bundle.register.totalQuantity) }, loc)
	);

	const parts: string[] = [
		m.dispute_bundle_heading({ date: bundle.date }, loc),
		'',
		...section(m.dispute_bundle_day_heading({}, loc), [
			`${m.day_detail_contract_label({}, loc)}: ${bundle.contract.title}`,
			`${m.day_detail_client_label({}, loc)}: ${bundle.contract.clientName}`,
			`${m.day_detail_scope_label({}, loc)}: ${bundle.scope}`,
			`${m.day_detail_quantity_label({}, loc)}: ${bundle.quantity}`
		]),
		...section(
			m.day_detail_approval_label({}, loc),
			bundle.approval
				? [formatApprovalReference(bundle.approval), `"${bundle.approval.excerpt}"`]
				: [m.day_detail_approval_none({}, loc)]
		),
		...section(
			m.day_detail_document_label({}, loc),
			bundle.document
				? [m.dispute_bundle_document_present({ name: bundle.document.originalName }, loc)]
				: [m.source_document_none({}, loc)]
		),
		...section(
			m.dispute_bundle_register_heading(
				{ from: bundle.register.from, to: bundle.register.to },
				loc
			),
			registerLines
		),
		...section(
			m.clause_note_section_heading({}, loc),
			bundle.clauseNotes.length > 0
				? bundle.clauseNotes.map(
						(note) =>
							`${note.clauseReference}: "${note.verbatimText}" — ${note.interpretationAdopted}`
					)
				: [m.clause_note_empty({}, loc)]
		),
		...section(
			m.day_detail_invoice_label({}, loc),
			bundle.invoiceLine
				? [
						`${bundle.invoiceLine.invoiceNumber} — ${bundle.invoiceLine.lineDescription} — ${minorUnitsToDecimalString(bundle.invoiceLine.amount, bundle.invoiceLine.currency)} ${bundle.invoiceLine.currency}`
					]
				: [m.dispute_bundle_invoice_line_none({}, loc)]
		)
	];

	return parts.join('\n').replace(/\n+$/, '\n');
}
