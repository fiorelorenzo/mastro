/**
 * Why a proposal cannot be accepted as it stands, as data rather than as a
 * sentence.
 *
 * This used to be a string, and the string was English: a reviewer on an
 * Italian screen was shown `contract.renewalNoticeDays is required and must
 * be >= 0 when renewalType is 'explicit'`, twice, with the field path and
 * the enum value in it. Translating those thirty strings was not the fix,
 * because the English text was load-bearing — the review screen recovered
 * which input to mark invalid by regex-matching field names out of the
 * message (`proposalValidationField`, now gone). Any translation would have
 * silently broken the field highlighting.
 *
 * So the failing field, the reason and the values are three separate things
 * now. The server names them; the interface says them, in whatever language
 * it is speaking.
 *
 * This module is free-standing and lives outside `$lib/server` for the same
 * reason `$lib/legal/legal-text.ts` does: the component that renders the
 * issue is client-side, and SvelteKit refuses to bundle `$lib/server` into
 * client code.
 */

/**
 * One code per distinct explanation, not one per call site: the thirty
 * strings this replaced said the same dozen-odd things about different
 * fields, and a reviewer reads the explanation, not the call site.
 */
export type ProposalValidationCode =
	/** The target needs a contract to be scoped by, and the proposal has none. */
	| 'contract_required'
	/** A NOT NULL column the producer left null — usually because a clause read two ways. */
	| 'field_required'
	/** The field parser itself refused; `detail` carries its own message. */
	| 'parse_failed'
	| 'must_be_positive'
	| 'must_not_be_negative'
	| 'out_of_range'
	/** More digits than the target column holds (`numeric(6,2)`). */
	| 'too_large_for_column'
	| 'not_a_real_date'
	| 'ends_before_starts'
	| 'valid_to_before_valid_from'
	/** An ISO code of a fixed length, e.g. a two-letter country or three-letter currency. */
	| 'must_be_uppercase_letters'
	| 'must_not_be_empty'
	| 'renewal_notice_not_allowed'
	| 'renewal_notice_required'
	| 'only_for_kind'
	| 'required_for_kind'
	| 'overlapping_validity'
	/** A flagged clause whose reading nobody has chosen yet. */
	| 'interpretation_required';

/**
 * Values the message interpolates. Deliberately flat and primitive: it is
 * persisted as JSON in `proposal.validation_issue` and read back by a
 * component, so anything that does not survive `JSON.parse` unchanged has
 * no business being in here.
 */
export type ProposalValidationParams = Readonly<Record<string, string | number>>;

export interface ProposalValidationIssue {
	/**
	 * The input a reviewer has to fix, by its own form field name, or null
	 * when the problem is not about one field (a missing contract, an
	 * overlap between two rate cards). The review screen marks this input
	 * invalid and falls back to a form-wide banner when it is null — the
	 * same two behaviours as before, without inferring either from prose.
	 */
	readonly field: string | null;
	/** Which row, when `field` names one of a list (invoice lines, rate cards). */
	readonly index: number | null;
	readonly code: ProposalValidationCode;
	readonly params: ProposalValidationParams;
}

export function validationIssue(
	code: ProposalValidationCode,
	options: {
		field?: string | null;
		index?: number | null;
		params?: ProposalValidationParams;
	} = {}
): ProposalValidationIssue {
	return {
		code,
		field: options.field ?? null,
		index: options.index ?? null,
		params: options.params ?? {}
	};
}

/**
 * Whether a value read back out of the database is an issue this build
 * understands.
 *
 * A stored issue outlives the code that wrote it: a row written before a
 * code was renamed, or by a newer deploy during a rollback, must not throw
 * on a review screen. An unrecognised shape reads as "no stored issue",
 * which is safe, because the stored value is a display cache and never the
 * gate — `acceptProposal` recomputes the issue against the fields actually
 * being written before it writes anything.
 */
export function isProposalValidationIssue(value: unknown): value is ProposalValidationIssue {
	if (typeof value !== 'object' || value === null) return false;
	const candidate = value as Record<string, unknown>;
	return (
		typeof candidate.code === 'string' &&
		(candidate.field === null || typeof candidate.field === 'string') &&
		(candidate.index === null || typeof candidate.index === 'number') &&
		typeof candidate.params === 'object' &&
		candidate.params !== null &&
		!Array.isArray(candidate.params)
	);
}
