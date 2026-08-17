import { expect, test } from 'vitest';
import { getLocale, overwriteGetLocale } from '$lib/paraglide/runtime';
import {
	validationIssue,
	type ProposalValidationCode,
	type ProposalValidationIssue
} from '$lib/proposals/validation-issue';
import { proposalIssueMessage } from './proposal-issue';

/**
 * One representative issue per code, built as a `Record` keyed by
 * `ProposalValidationCode` rather than a plain array: a code added to that
 * union without an entry here fails the build, the same exhaustiveness
 * `proposalIssueMessage`'s own switch relies on.
 */
const SAMPLE_ISSUES: Record<ProposalValidationCode, ProposalValidationIssue> = {
	contract_required: validationIssue('contract_required'),
	parse_failed: validationIssue('parse_failed', { params: { detail: 'unexpected token' } }),
	field_required: validationIssue('field_required', { field: 'renewalType' }),
	must_be_positive: validationIssue('must_be_positive', {
		field: 'quantity',
		params: { value: -1 }
	}),
	must_not_be_negative: validationIssue('must_not_be_negative', {
		field: 'amount',
		index: 0,
		params: { value: -50 }
	}),
	out_of_range: validationIssue('out_of_range', {
		field: 'taxRate',
		index: 1,
		params: { value: 140, min: 0, max: 100 }
	}),
	too_large_for_column: validationIssue('too_large_for_column', {
		field: 'quantity',
		params: { value: 99999 }
	}),
	not_a_real_date: validationIssue('not_a_real_date', {
		field: 'date',
		params: { value: '2026-02-31' }
	}),
	ends_before_starts: validationIssue('ends_before_starts', {
		field: 'endsOn',
		params: { value: '2025-01-01', other: '2025-06-01' }
	}),
	valid_to_before_valid_from: validationIssue('valid_to_before_valid_from', {
		field: 'validTo',
		index: 0
	}),
	must_be_uppercase_letters: validationIssue('must_be_uppercase_letters', {
		field: 'country',
		params: { value: 'it', count: 2 }
	}),
	must_not_be_empty: validationIssue('must_not_be_empty', {
		field: 'allowedFractions',
		index: 0
	}),
	renewal_notice_not_allowed: validationIssue('renewal_notice_not_allowed', {
		field: 'renewalNoticeDays'
	}),
	renewal_notice_required: validationIssue('renewal_notice_required', {
		field: 'renewalNoticeDays',
		params: { renewalType: 'explicit' }
	}),
	only_for_kind: validationIssue('only_for_kind', {
		field: 'minimumHours',
		index: 0,
		params: { kind: 'hourly' }
	}),
	required_for_kind: validationIssue('required_for_kind', {
		field: 'disbursementPeriod',
		index: 2,
		params: { kind: 'fixed_recurring' }
	}),
	overlapping_validity: validationIssue('overlapping_validity', {
		params: { first: 0, second: 1 }
	}),
	interpretation_required: validationIssue('interpretation_required', {
		params: { clause: '3.2', field: 'renewalType' }
	})
};

test('every code renders a real sentence, in both languages', () => {
	const originalGetLocale = getLocale;
	try {
		for (const locale of ['en', 'it'] as const) {
			overwriteGetLocale(() => locale);
			for (const [code, issue] of Object.entries(SAMPLE_ISSUES)) {
				const message = proposalIssueMessage(issue);
				expect(message.length, `${code} (${locale}) rendered empty`).toBeGreaterThan(0);
				expect(message, `${code} (${locale}) leaked an undefined interpolation`).not.toMatch(
					/undefined/
				);
				expect(message, `${code} (${locale}) left a placeholder unresolved`).not.toContain('{');
			}
		}
	} finally {
		overwriteGetLocale(originalGetLocale);
	}
});

// The live incident #320 exists to fix: an Italian review screen showing
// `contract.renewalNoticeDays is required and must be >= 0 when
// renewalType is 'explicit'`, in English, twice. This is that exact case,
// asserted in both languages so a regression here is caught the same way
// the incident itself would have been.
test('the live incident renders as a real sentence in both languages', () => {
	const issue = validationIssue('renewal_notice_required', {
		field: 'renewalNoticeDays',
		params: { renewalType: 'explicit' }
	});
	const originalGetLocale = getLocale;
	try {
		overwriteGetLocale(() => 'en');
		expect(proposalIssueMessage(issue)).toBe(
			'Renewal notice (days) must be specified as zero or more because renewal is Explicit.'
		);

		overwriteGetLocale(() => 'it');
		expect(proposalIssueMessage(issue)).toBe(
			'È necessario indicare Preavviso di rinnovo (giorni) (un valore pari o superiore a zero) perché il rinnovo è Esplicito.'
		);
	} finally {
		overwriteGetLocale(originalGetLocale);
	}
});

test('an indexed issue is prefixed with its row number', () => {
	const issue = validationIssue('must_not_be_empty', { field: 'allowedFractions', index: 2 });
	const originalGetLocale = getLocale;
	try {
		overwriteGetLocale(() => 'en');
		expect(proposalIssueMessage(issue)).toBe(
			'Row 3: Allowed fractions must contain at least one value.'
		);
	} finally {
		overwriteGetLocale(originalGetLocale);
	}
});
