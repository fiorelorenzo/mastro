import * as m from '$lib/paraglide/messages';

/**
 * What a proposal is about, and whether its evidence arrived as mail — the
 * two facts every decision string on the review screen needs, and the two
 * it used to assume (#356).
 *
 * The screen shipped one accept toast reading "the day is recorded" for all
 * three target types, so accepting the first real contract announced a day
 * that had not been written; and three more strings called the evidence "the
 * archived message" whatever it was, which put the heading "Archived
 * message" directly above `visum-354.pdf · Uploaded`. Wording that
 * contradicts the card it sits in is not cosmetic here: these strings are
 * where the product explains invariant 4 - every derived datum keeps its
 * source document - to the person being asked to trust it.
 *
 * `fromMessage` is the queue's own signal (`proposals/+page.server.ts`:
 * an inbound thread exists for that document), not `document.provenance`.
 * It is the stronger fact - there is an archived message to point at - and
 * reusing it is what keeps the queue and this screen from describing one
 * proposal two ways.
 *
 * Centralised rather than branched inline for the reason `proposal-status.ts`
 * next door is: the alternative is a check per string, and the next target
 * type added then ships the wrong noun from whichever site nobody updated.
 */

/**
 * Mirrors the `proposal_target_type` values a proposal can carry
 * (`$lib/server/db/schema/proposal.ts`), duplicated as a plain literal list
 * for the same reason `proposalStatuses` is: this module is used from client
 * components, and `$lib/server/db/schema` cannot be bundled into client code.
 */
export const proposalTargetTypes = ['work_unit', 'contract', 'invoice'] as const;
export type ProposalTargetTypeValue = (typeof proposalTargetTypes)[number];

/** What was written, in the same words as the button that wrote it. */
export function acceptedToast(targetType: ProposalTargetTypeValue): string {
	switch (targetType) {
		case 'work_unit':
			return m.proposal_accept_toast_work_unit();
		case 'contract':
			return m.proposal_accept_toast_contract();
		case 'invoice':
			return m.proposal_accept_toast_invoice();
	}
}

/**
 * A rejection promises the evidence stays put either way, so it has to name
 * the thing that stays.
 */
export function rejectedToast(fromMessage: boolean): string {
	return fromMessage ? m.proposal_reject_toast() : m.proposal_reject_toast_document();
}

/** The same promise, at the length the confirmation dialog has room for. */
export function rejectConfirmBody(fromMessage: boolean): string {
	return fromMessage ? m.proposal_reject_confirm_body() : m.proposal_reject_confirm_body_document();
}

/** The evidence card's own heading. */
export function evidenceHeading(fromMessage: boolean): string {
	return fromMessage ? m.proposal_evidence_heading() : m.proposal_evidence_heading_document();
}

/**
 * The evidence card's promise, which names what the document stays attached
 * to. Rendered on every proposal, so on a contract one it read "stays
 * linked to the day".
 */
export function evidenceDocumentHint(targetType: ProposalTargetTypeValue): string {
	switch (targetType) {
		case 'work_unit':
			return m.proposal_evidence_document_hint();
		case 'contract':
			return m.proposal_evidence_document_hint_contract();
		case 'invoice':
			return m.proposal_evidence_document_hint_invoice();
	}
}

/**
 * Why a proposed field carries no highlight: the excerpt does not contain
 * it. Says which kind of source failed to state it.
 */
export function notGroundedHint(fromMessage: boolean): string {
	return fromMessage
		? m.proposal_field_hint_not_grounded()
		: m.proposal_field_hint_not_grounded_document();
}

/**
 * "2 of 5 from this message" — siblings are the other proposals read out of
 * the *same document*, which is only a message some of the time.
 */
export function siblingPosition(
	fromMessage: boolean,
	position: { index: number; count: number }
): string {
	return fromMessage
		? m.proposal_review_sibling_position(position)
		: m.proposal_review_sibling_position_document(position);
}

/**
 * The queue's link to what an accepted proposal produced. Paired with
 * `HistoryRow['result']`, which carries the route: the label and the
 * destination are two halves of one fact and a template that picked them
 * separately is how "View the day →" came to point at a contract (#356).
 */
export function viewResultLabel(kind: 'work_unit' | 'contract' | 'invoice'): string {
	switch (kind) {
		case 'work_unit':
			return m.proposal_history_view_result_work_unit();
		case 'contract':
			return m.proposal_history_view_result_contract();
		case 'invoice':
			return m.proposal_history_view_result_invoice();
	}
}
