import { formatNumber } from '$lib/i18n/format';
import { BADGE_GLYPH } from '$lib/design';
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
 * A `work_unit` proposal's own quantity, in the product's established
 * vocabulary: `day_form_quantity_full`/`_half` are the exact strings
 * `day/new`'s own quantity picker already shows for 1 and 0.5 — the two
 * fractions every seeded rate card actually allows — so a reviewer reads
 * the same words recording a day by hand would have used. Anything else
 * (a rate card with a different fraction) falls back to a plain count.
 */
export function proposalQuantityLabel(quantity: number): string {
	if (quantity === 1) return m.day_form_quantity_full();
	if (quantity === 0.5) return m.day_form_quantity_half();
	return m.proposal_quantity_days({ days: formatNumber(quantity) });
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

/**
 * The confidence tier a review screen buckets a proposal's declared
 * confidence into for display — distinct from
 * `CONFIDENCE_NEEDS_REVIEW_THRESHOLD` in `$lib/server/agent/day-extraction.ts`,
 * which decides whether a day gets flagged *at extraction time*. The low
 * boundary mirrors that server-side threshold (0.5) so "needs review" and
 * "reads as low here" never disagree; the high boundary (0.85) is this
 * screen's own choice, picked so the seeded review's two real examples
 * read the way the mockup draws them (0.90 → high, 0.72 → medium).
 * `$lib/server/agent/day-extraction.ts` cannot be imported here — it is a
 * server module, this file ships to the client.
 */
export const PROPOSAL_CONFIDENCE_LOW_THRESHOLD = 0.5;
export const PROPOSAL_CONFIDENCE_HIGH_THRESHOLD = 0.85;

export const proposalConfidenceTiers = ['low', 'medium', 'high'] as const;
export type ProposalConfidenceTier = (typeof proposalConfidenceTiers)[number];

export function proposalConfidenceTier(confidence: number): ProposalConfidenceTier {
	if (confidence < PROPOSAL_CONFIDENCE_LOW_THRESHOLD) return 'low';
	if (confidence < PROPOSAL_CONFIDENCE_HIGH_THRESHOLD) return 'medium';
	return 'high';
}

/**
 * The `Badge` a proposal's declared confidence renders as. A plain
 * function, not a module-level `Record` built from `m.*()` calls the way
 * `day-state-badge.ts`'s tables are: those are evaluated exactly once, at
 * module import, so the label they carry is whatever locale happened to
 * be active at that moment — this calls the message function fresh on
 * every invocation instead, so it reads the request's actual locale
 * every time.
 */
export function proposalConfidenceBadge(confidence: number): {
	variant: 'good' | 'warning' | 'critical';
	glyph: string;
	label: string;
} {
	const tier = proposalConfidenceTier(confidence);
	switch (tier) {
		case 'high':
			return { variant: 'good', glyph: BADGE_GLYPH.good, label: m.proposal_confidence_high() };
		case 'medium':
			return {
				variant: 'warning',
				glyph: BADGE_GLYPH.warning,
				label: m.proposal_confidence_medium()
			};
		case 'low':
			return {
				variant: 'critical',
				glyph: BADGE_GLYPH.critical,
				label: m.proposal_confidence_low()
			};
	}
}

/**
 * Which of `fields` a proposal's `validationError` names, when it names
 * one — `proposalValidationError` in `repositories/proposal.ts` always
 * writes the failing field's own key literally into the message
 * ("quantity -1 must be greater than 0", "date 2026-02-31 is not a real
 * date", "proposal field 'scope' must be a string"), so finding the first
 * known field key mentioned in the text reliably recovers which input to
 * mark invalid. `null` when there is no error, or (defensively) when a
 * future validation message mentions none of the fields this proposal
 * actually carries — the review screen falls back to a form-wide banner
 * in that case rather than guessing.
 */
export function proposalValidationField(
	validationError: string | null,
	fields: readonly string[]
): string | null {
	if (!validationError) return null;
	return fields.find((field) => new RegExp(`\\b${field}\\b`, 'i').test(validationError)) ?? null;
}
