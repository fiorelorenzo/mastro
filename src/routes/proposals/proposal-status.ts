import * as m from '$lib/paraglide/messages';

/**
 * Mirrors the `proposal_status` Postgres enum
 * (`$lib/server/db/schema/proposal.ts`), duplicated here as a plain literal
 * list rather than imported: this file is used from client components
 * (`ProposalStatusBadge.svelte`), and `$lib/server/db/schema` cannot be
 * bundled into client code — the same reason `routes/day/work-unit-state.ts`
 * duplicates `work_unit_state`.
 */
export const proposalStatuses = ['pending', 'accepted', 'rejected'] as const;
export type ProposalStatusValue = (typeof proposalStatuses)[number];

export function proposalStatusLabel(status: ProposalStatusValue): string {
	switch (status) {
		case 'pending':
			return m.proposal_status_pending();
		case 'accepted':
			return m.proposal_status_accepted();
		case 'rejected':
			return m.proposal_status_rejected();
	}
}

/**
 * Mirrors `ProposalTargetType` (`$lib/server/db/schema/proposal.ts`) the
 * same way, for the same reason. Widened alongside it as #86 and #87 land.
 */
export type ProposalTargetTypeValue = 'work_unit';

export function proposalTargetTypeLabel(targetType: ProposalTargetTypeValue): string {
	switch (targetType) {
		case 'work_unit':
			return m.proposal_target_type_work_unit();
	}
}

/**
 * A proposed field's own label: the small set of field names #83's only
 * wired target type (`work_unit`) can produce get a proper translated
 * label; anything else — a future target type's field, or a producer
 * supplying more than the fields this file knows about — falls back to a
 * humanised version of the JSON key itself. That fallback is not a
 * hardcoded UI string: the key it humanises is producer-supplied data, not
 * copy this codebase writes, the same way an invoice line's own
 * description is never routed through the message catalogue either.
 */
const KNOWN_FIELD_LABELS: Record<string, () => string> = {
	date: m.proposal_field_date,
	quantity: m.proposal_field_quantity,
	scope: m.proposal_field_scope,
	notes: m.proposal_field_notes
};

export function proposalFieldLabel(field: string): string {
	const known = KNOWN_FIELD_LABELS[field];
	if (known) return known();
	return field
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/[_-]+/g, ' ')
		.replace(/^./, (char) => char.toUpperCase());
}
