/**
 * Turns a `ProposalValidationIssue` (`$lib/proposals/validation-issue.ts`)
 * into the sentence a reviewer reads — the fix for the incident that module
 * exists to explain: an Italian review screen showing `contract.
 * renewalNoticeDays is required and must be >= 0 when renewalType is
 * 'explicit'`, twice, because the thirty English diagnostic strings that
 * used to live in `proposalValidationError` were never translated (nor
 * translatable, since `proposalValidationField` recovered the offending
 * input by regex-matching field names out of that same English text).
 *
 * The switch below is exhaustive over `ProposalValidationCode` — no
 * `default`, so a code added to that union without a case here fails the
 * build, the same guarantee `applyProposal`'s own switch gives target
 * types. `field`/`kind`/`renewalType` values are resolved to a label
 * before they reach a message key: nothing here ever hands a raw producer
 * key or a raw Postgres enum value to an interpolation slot.
 */
import * as m from '$lib/paraglide/messages';
import { formatDate, formatNumber } from './format';
import type { ProposalValidationIssue } from '$lib/proposals/validation-issue';

/**
 * Every field name one of the eighteen codes can name, closed the same way
 * `ClientInvoicingField` is in `client-fields.ts`: the switch below is
 * exhaustive over this list, so a code added later that points at a new
 * field fails the build here rather than silently falling through to the
 * humanised fallback. Reuses the label a field already carries elsewhere in
 * the app (the contract form, the invoice form, the rate card form, the
 * work_unit proposal fields) rather than naming any of them a second time.
 */
const PROPOSAL_ISSUE_FIELDS = [
	'renewalNoticeDays',
	'renewalType',
	'paymentTerms',
	'expensePolicy',
	'taxTreatment',
	'terminationNoticeDays',
	'startsOn',
	'endsOn',
	'currency',
	'country',
	'quantity',
	'date',
	'issueDate',
	'dueDate',
	'unitPrice',
	'amount',
	'taxRate',
	'minimumHours',
	'disbursementPeriod',
	'allowedFractions',
	'validTo',
	'validFrom'
] as const;
type ProposalIssueField = (typeof PROPOSAL_ISSUE_FIELDS)[number];

function isProposalIssueField(field: string): field is ProposalIssueField {
	return (PROPOSAL_ISSUE_FIELDS as readonly string[]).includes(field);
}

function knownFieldLabel(field: ProposalIssueField): string {
	switch (field) {
		case 'renewalNoticeDays':
			return m.contract_form_renewal_notice_days_label();
		case 'renewalType':
			return m.contract_form_renewal_type_label();
		case 'paymentTerms':
			return m.contract_form_payment_terms_kind_label();
		case 'expensePolicy':
			return m.contract_form_expense_policy_kind_label();
		case 'taxTreatment':
			return m.contract_form_tax_treatment_label();
		case 'terminationNoticeDays':
			return m.contract_form_termination_notice_days_label();
		case 'startsOn':
			return m.contract_form_starts_on_label();
		case 'endsOn':
			return m.contract_form_ends_on_label();
		case 'currency':
			return m.contract_form_currency_label();
		case 'country':
			return m.client_form_country_label();
		case 'quantity':
			return m.proposal_field_quantity();
		case 'date':
			return m.proposal_field_date();
		case 'issueDate':
			return m.invoice_form_issue_date_label();
		case 'dueDate':
			return m.invoice_form_due_date_label();
		case 'unitPrice':
			return m.invoice_form_line_unit_price_label();
		case 'amount':
			return m.rate_card_form_amount_label();
		case 'taxRate':
			return m.invoice_form_line_tax_rate_label();
		case 'minimumHours':
			return m.rate_card_form_minimum_hours_label();
		case 'disbursementPeriod':
			return m.rate_card_form_disbursement_period_label();
		case 'allowedFractions':
			return m.rate_card_form_allowed_fractions_label();
		case 'validTo':
			return m.rate_card_form_valid_to_label();
		case 'validFrom':
			return m.rate_card_form_valid_from_label();
	}
}

/**
 * A field name's own label, or a humanised version of the key itself for
 * one this build does not recognise — the same defensive fallback
 * `proposalFieldLabel` (`routes/proposals/proposal-status.ts`) uses, and
 * for the same reason `isProposalValidationIssue` stays permissive: a
 * stored issue can outlive the code that wrote it, and a review screen
 * must never crash over a shape it does not fully understand.
 */
function fieldLabel(field: string): string {
	if (isProposalIssueField(field)) return knownFieldLabel(field);
	return field
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/[_-]+/g, ' ')
		.replace(/^./, (char) => char.toUpperCase());
}

/** `renewal_notice_required`'s own `renewalType` param — one of
 *  `contractRenewalTypes` (`clients/[id]/contracts/contract-enums.ts`),
 *  duplicated here rather than imported: `$lib/i18n` does not depend on
 *  `src/routes`, the same boundary `$lib/server` enforces the other
 *  direction. Falls back to the raw value for one this build predates. */
function renewalTypeParamLabel(value: string): string {
	switch (value) {
		case 'none':
			return m.contract_renewal_type_none();
		case 'explicit':
			return m.contract_renewal_type_explicit();
		case 'counterparty_option':
			return m.contract_renewal_type_counterparty_option();
		case 'tacit':
			return m.contract_renewal_type_tacit();
		default:
			return value;
	}
}

/** `only_for_kind`/`required_for_kind`'s own `kind` param — one of
 *  `rateCardKinds` (`rate-cards/rate-card-enums.ts`), duplicated for the
 *  same reason `renewalTypeParamLabel` is. */
function rateCardKindParamLabel(value: string): string {
	switch (value) {
		case 'daily':
			return m.rate_card_kind_daily();
		case 'hourly':
			return m.rate_card_kind_hourly();
		case 'fixed_recurring':
			return m.rate_card_kind_fixed_recurring();
		case 'one_off':
			return m.rate_card_kind_one_off();
		default:
			return value;
	}
}

function numberParam(value: string | number | undefined): number {
	return typeof value === 'number' ? value : Number(value ?? 0);
}

function stringParam(value: string | number | undefined): string {
	return value === undefined ? '' : String(value);
}

function codeSentence(issue: ProposalValidationIssue): string {
	const { code, params } = issue;
	// Resolved once: every code below that names a field uses this same
	// label, so the sentence and the input the review screen marks invalid
	// (`issue.field`, read directly by the caller) can never disagree.
	const field = issue.field !== null ? fieldLabel(issue.field) : '';
	switch (code) {
		case 'contract_required':
			return m.proposal_issue_contract_required();
		case 'parse_failed':
			return m.proposal_issue_parse_failed({ detail: stringParam(params.detail) });
		case 'field_required':
			return m.proposal_issue_field_required({ field });
		case 'must_be_positive':
			return m.proposal_issue_must_be_positive({
				field,
				value: formatNumber(numberParam(params.value))
			});
		case 'must_not_be_negative':
			return m.proposal_issue_must_not_be_negative({
				field,
				value: formatNumber(numberParam(params.value))
			});
		case 'out_of_range':
			return m.proposal_issue_out_of_range({
				field,
				value: formatNumber(numberParam(params.value)),
				min: formatNumber(numberParam(params.min)),
				max: formatNumber(numberParam(params.max))
			});
		case 'too_large_for_column':
			return m.proposal_issue_too_large_for_column({
				field,
				value: formatNumber(numberParam(params.value))
			});
		case 'not_a_real_date':
			// The value is exactly what makes this not a real date (e.g.
			// "2026-02-31") — `formatDate` would throw or misparse it, so it
			// renders as the raw string a producer read off the source.
			return m.proposal_issue_not_a_real_date({ field, value: stringParam(params.value) });
		case 'ends_before_starts':
			return m.proposal_issue_ends_before_starts({
				field,
				value: formatDate(stringParam(params.value)),
				other: formatDate(stringParam(params.other))
			});
		case 'valid_to_before_valid_from':
			return m.proposal_issue_valid_to_before_valid_from({ field });
		case 'must_be_uppercase_letters':
			return m.proposal_issue_must_be_uppercase_letters({
				field,
				value: stringParam(params.value),
				count: formatNumber(numberParam(params.count))
			});
		case 'must_not_be_empty':
			return m.proposal_issue_must_not_be_empty({ field });
		case 'renewal_notice_not_allowed':
			return m.proposal_issue_renewal_notice_not_allowed({ field });
		case 'renewal_notice_required':
			return m.proposal_issue_renewal_notice_required({
				field,
				renewalType: renewalTypeParamLabel(stringParam(params.renewalType))
			});
		case 'only_for_kind':
			return m.proposal_issue_only_for_kind({
				field,
				kind: rateCardKindParamLabel(stringParam(params.kind))
			});
		case 'required_for_kind':
			return m.proposal_issue_required_for_kind({
				field,
				kind: rateCardKindParamLabel(stringParam(params.kind))
			});
		case 'overlapping_validity':
			// Two rows, not one field — `first`/`second` are the pair's own
			// list positions, not `issue.index` (there is no single row this
			// issue is "about"), 1-based the same way the row prefix below is.
			return m.proposal_issue_overlapping_validity({
				first: formatNumber(numberParam(params.first) + 1),
				second: formatNumber(numberParam(params.second) + 1)
			});
		case 'interpretation_required':
			// `params.clause` is the clause's own verbatim reference — data
			// from the source document, never translated, the same reason a
			// `LegalText` renders as-is. `params.field` is a second field
			// name (the one the clause determines), resolved the same way
			// `issue.field` is; `issue.field` itself stays null here because
			// no single named input is "the" offending one — the review
			// screen's own clause-reading picker gates Accept instead.
			return m.proposal_issue_interpretation_required({
				clause: stringParam(params.clause),
				field: fieldLabel(stringParam(params.field))
			});
	}
}

/**
 * The sentence a reviewer reads for one `ProposalValidationIssue`, in
 * whichever language the interface is speaking. `issue.index`, when set,
 * names which row of a list (an invoice line, a rate card) the issue is
 * about — resolved into a "Row N" prefix here, once, rather than inside
 * every per-code message, since more than one code fires for both an
 * indexed and an unindexed field (`must_be_positive` is a work_unit's own
 * `quantity` as often as it is one invoice line's).
 */
export function proposalIssueMessage(issue: ProposalValidationIssue): string {
	const sentence = codeSentence(issue);
	if (issue.index === null) return sentence;
	return m.proposal_issue_row_label({ row: formatNumber(issue.index + 1), issue: sentence });
}
