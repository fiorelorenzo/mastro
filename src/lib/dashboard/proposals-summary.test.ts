import { expect, test } from 'vitest';
import { pendingProposalDay, pendingProposalsSummary } from './proposals-summary';

test('reads date/quantity off proposedFields, the same two keys accepting one trusts', () => {
	expect(pendingProposalDay({ date: '2026-08-17', quantity: 1, scope: 'x' })).toEqual({
		date: '2026-08-17',
		quantity: 1
	});
});

test('an unexpected shape (never written by createProposal, but not trusted blindly) yields null', () => {
	expect(pendingProposalDay({})).toBeNull();
	expect(pendingProposalDay({ date: 5, quantity: 1 })).toBeNull();
	expect(pendingProposalDay({ date: '2026-08-17', quantity: '1' })).toBeNull();
});

test('summarises every day, ascending, joined in words', () => {
	const summary = pendingProposalsSummary(
		[
			{ date: '2026-08-18', quantity: 0.5 },
			{ date: '2026-08-17', quantity: 1 }
		],
		'en'
	);
	expect(summary).toContain('Aug 17, 2026');
	expect(summary).toContain('Aug 18, 2026');
	// Ascending despite the input order.
	expect(summary.indexOf('17')).toBeLessThan(summary.indexOf('18'));
});

test('an empty list summarises to an empty string, not a dangling conjunction', () => {
	expect(pendingProposalsSummary([], 'en')).toBe('');
});
