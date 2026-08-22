import { describe, expect, test } from 'vitest';
import { proposalRevised, proposedContract, workUnitFields } from './queue-fields';

/** A contract the extraction could have written, in the shape
 *  `parseExtractedContract` demands — the live Visum Labs upload, with the
 *  ambiguous `renewalNoticeDays` it actually carried. */
function contractFields(over: Record<string, unknown> = {}) {
	return {
		client: {
			legalName: 'Visum Labs Ltd',
			taxId: null,
			vatId: null,
			country: 'GB',
			addressLine1: 'Flat 1303 Cobalt Point',
			addressLine2: null,
			addressCity: 'London',
			addressPostalCode: 'E14 9JU',
			addressRegion: 'England'
		},
		contract: {
			title: 'Independent Contractor Agreement',
			signedDocumentReference: null,
			startsOn: '2026-08-03',
			endsOn: '2026-09-02',
			renewalType: 'explicit',
			renewalNoticeDays: null,
			terminationNoticeDays: 5,
			paymentTerms: { kind: 'net', days: 14 },
			invoicingCadence: 'monthly',
			currency: 'EUR',
			taxTreatment: 'reverse_charge',
			requiresPriorApproval: true,
			requiresExpensePreAuthorisation: true,
			expensePolicy: { kind: 'reimbursed_at_cost' }
		},
		rateCards: [
			{
				validFrom: '2026-08-03',
				validTo: null,
				kind: 'daily',
				amount: 500,
				unit: 'day',
				allowedFractions: [1, 0.5],
				minimumHours: 8,
				disbursementPeriod: null
			}
		],
		clauseFlags: [],
		...over
	};
}

describe('workUnitFields', () => {
	test('reads a day proposal', () => {
		expect(workUnitFields({ date: '2026-08-25', quantity: 1, scope: 'Chiusura mensile' })).toEqual({
			date: '2026-08-25',
			quantity: 1,
			scope: 'Chiusura mensile'
		});
	});

	// A contract proposal's fields go through here too, on the way to
	// pricing, and must not be mistaken for a day.
	test('a contract proposal is not a day', () => {
		expect(workUnitFields(contractFields())).toBeNull();
	});

	test.each([
		[{ date: '2026-08-25', quantity: 1 }],
		[{ date: 20260825, quantity: 1, scope: 'x' }],
		[{ date: '2026-08-25', quantity: '1', scope: 'x' }],
		[{}]
	])('%p is not a day', (fields) => {
		expect(workUnitFields(fields)).toBeNull();
	});
});

describe('proposedContract', () => {
	test('carries the counterparty, the terms and the rates a card shows', () => {
		const summary = proposedContract(contractFields());
		expect(summary?.clientLegalName).toBe('Visum Labs Ltd');
		expect(summary?.contract.title).toBe('Independent Contractor Agreement');
		expect(summary?.contract.startsOn).toBe('2026-08-03');
		expect(summary?.contract.paymentTerms).toEqual({ kind: 'net', days: 14 });
		expect(summary?.contract.requiresPriorApproval).toBe(true);
		expect(summary?.rateCards).toHaveLength(1);
		expect(summary?.rateCards[0].amount).toBe(500);
	});

	// The card shows the terms and nothing else. Clause spans and the
	// client's postal address are the review screen's business, and
	// shipping them in every queue payload would be pointless weight.
	test('leaves the clause flags and the address on the server', () => {
		const summary = proposedContract(
			contractFields({
				clauseFlags: [
					{
						verbatimText: 'a clause long enough to stand as evidence on its own, quoted here',
						readings: ['one reading', 'another reading'],
						field: 'contract.renewalType'
					}
				]
			})
		);
		expect(summary).not.toBeNull();
		expect(Object.keys(summary!)).toEqual(['clientLegalName', 'contract', 'rateCards']);
	});

	// The field the live proposal was blocked on is ambiguous by design, so
	// it must survive the read as null rather than failing it: the card has
	// to render the proposal that cannot be accepted yet.
	test('an unresolved renewal notice is read, not refused', () => {
		expect(proposedContract(contractFields())?.contract.renewalNoticeDays).toBeNull();
	});

	test('a day proposal is not a contract', () => {
		expect(proposedContract({ date: '2026-08-25', quantity: 1, scope: 'x' })).toBeNull();
	});

	// `parseExtractedContract` throws on a shape it does not recognise,
	// which is right for a writer and wrong here: the queue is one page
	// listing every pending proposal, so one bad row must not take the
	// other rows' cards down with it.
	test.each([
		['no rate card at all', contractFields({ rateCards: [] })],
		['a blank counterparty', contractFields({ client: { legalName: '  ', country: 'IT' } })],
		[
			'an invented payment kind',
			{
				...contractFields(),
				contract: { ...contractFields().contract, paymentTerms: { kind: 'weekly', days: 7 } }
			}
		],
		['nothing at all', {}]
	])('%s reads as null instead of throwing', (_label, fields) => {
		expect(proposedContract(fields as Record<string, unknown>)).toBeNull();
	});
});

// #409's queue badge: `proposalRevised`'s predicate has two halves. A
// fixture that only ever UPDATE-bumps `updated_at` exercises the true side
// of both — a fresh, untouched pending row and a decided row are the two
// cases that must stay false, and neither showed up in the browser
// verification that shipped this.
describe('proposalRevised', () => {
	test('a fresh pending proposal, untouched since creation, is not revised', () => {
		const createdAt = new Date('2026-08-20T09:00:00.000Z');
		expect(proposalRevised({ status: 'pending', createdAt, updatedAt: new Date(createdAt) })).toBe(
			false
		);
	});

	// The tolerance is the whole reason the comparison is not `> 0`: both
	// timestamps default to `now()` on one INSERT and can land a clock
	// sliver apart. Without this case, narrowing the rule to `> 0` would
	// keep every other test green and light the badge on every fresh row.
	test('a pending proposal whose two timestamps differ by a sliver is not revised', () => {
		const createdAt = new Date('2026-08-20T09:00:00.000Z');
		const updatedAt = new Date(createdAt.getTime() + 300);
		expect(proposalRevised({ status: 'pending', createdAt, updatedAt })).toBe(false);
	});

	test('a pending proposal whose updatedAt moved well past createdAt is revised', () => {
		const createdAt = new Date('2026-08-20T09:00:00.000Z');
		const updatedAt = new Date(createdAt.getTime() + 2 * 60 * 60 * 1000);
		expect(proposalRevised({ status: 'pending', createdAt, updatedAt })).toBe(true);
	});

	test('a decided proposal never reads as revised, however far updatedAt moved', () => {
		const createdAt = new Date('2026-08-20T09:00:00.000Z');
		const updatedAt = new Date(createdAt.getTime() + 2 * 60 * 60 * 1000);
		expect(proposalRevised({ status: 'accepted', createdAt, updatedAt })).toBe(false);
		expect(proposalRevised({ status: 'rejected', createdAt, updatedAt })).toBe(false);
	});
});
