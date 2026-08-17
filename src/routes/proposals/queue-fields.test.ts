import { describe, expect, test } from 'vitest';
import { contractFields, workUnitFields } from './queue-fields';

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
		expect(
			workUnitFields({ client: { legalName: 'Visum Labs Ltd' }, contract: { title: 'Agreement' } })
		).toBeNull();
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

describe('contractFields', () => {
	// The live case: a first-intake contract proposal was described with a
	// day's own template and rendered "— — —", because a contract has
	// neither a date nor a quantity to put on either side of the dash.
	test('reads the counterparty and the title a queue row needs', () => {
		expect(
			contractFields({
				client: { legalName: 'Visum Labs Ltd', country: 'GB', taxId: null },
				contract: { title: 'Independent Contractor Agreement', startsOn: '2026-08-03' }
			})
		).toEqual({ clientLegalName: 'Visum Labs Ltd', title: 'Independent Contractor Agreement' });
	});

	test('a day proposal carries neither, and says so', () => {
		expect(contractFields({ date: '2026-08-25', quantity: 1, scope: 'x' })).toBeNull();
	});

	// Blank is not a label: falling back to the generic one reads better
	// than a row whose title is empty space.
	test.each([
		[{ client: { legalName: '   ' }, contract: { title: 'Agreement' } }],
		[{ client: { legalName: 'Visum Labs Ltd' }, contract: { title: '' } }]
	])('%p has nothing to show', (fields) => {
		expect(contractFields(fields)).toBeNull();
	});

	test.each([
		[{ client: null, contract: { title: 'x' } }],
		[{ client: { legalName: 'x' }, contract: null }],
		[{ client: 'Visum Labs Ltd', contract: { title: 'x' } }],
		[{ client: { name: 'x' }, contract: { title: 'x' } }],
		[{ client: { legalName: 42 }, contract: { title: 'x' } }],
		[{}]
	])('%p is refused rather than half-read', (fields) => {
		expect(contractFields(fields)).toBeNull();
	});
});
