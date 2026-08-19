import { expect, test } from 'vitest';
import { contractRows, type ContractSource, type RateCardSource } from './rows';

function contract(overrides: Partial<ContractSource> & { id: string }): ContractSource {
	return {
		title: 'Retainer',
		status: 'active',
		startsOn: '2026-01-01',
		endsOn: null,
		currency: 'EUR',
		requiresPriorApproval: true,
		mailFolder: null,
		client: { id: 'client-1', legalName: 'Acme S.r.l.' },
		...overrides
	};
}

let cardSeq = 0;
function card(overrides: Partial<RateCardSource> & { contractId: string }): RateCardSource {
	return {
		id: `card-${++cardSeq}`,
		validFrom: '2026-01-01',
		validTo: null,
		amount: '500.00',
		unit: 'day',
		...overrides
	};
}

test("a contract only ever sees its own cards, with several clients' contracts interleaved", () => {
	// The realistic shape: one query returns every card for every contract,
	// so a grouping bug shows up as one contract wearing another's rate.
	const rows = contractRows(
		[
			contract({ id: 'c1', client: { id: 'client-1', legalName: 'Acme S.r.l.' } }),
			contract({ id: 'c2', client: { id: 'client-2', legalName: 'Beta Ltd' } }),
			contract({ id: 'c3', client: { id: 'client-1', legalName: 'Acme S.r.l.' } })
		],
		[
			card({ contractId: 'c2', amount: '900.00', unit: 'day' }),
			card({ contractId: 'c1', amount: '500.00', unit: 'day' }),
			card({ contractId: 'c3', amount: '80.00', unit: 'hour' })
		],
		'2026-06-01'
	);

	expect(rows.map((row) => [row.id, row.rateInForce])).toEqual([
		['c1', { amount: 500, unit: 'day' }],
		['c2', { amount: 900, unit: 'day' }],
		['c3', { amount: 80, unit: 'hour' }]
	]);
	expect(rows.map((row) => row.clientLegalName)).toEqual([
		'Acme S.r.l.',
		'Beta Ltd',
		'Acme S.r.l.'
	]);
});

test('no card covering the date is null, which the page renders as an explicit state', () => {
	const rows = contractRows([contract({ id: 'c1' })], [], '2026-06-01');

	expect(rows[0].rateInForce).toBeNull();
});

test('a card whose validity has ended does not count as in force', () => {
	const rows = contractRows(
		[contract({ id: 'c1' })],
		[card({ contractId: 'c1', validFrom: '2026-01-01', validTo: '2026-03-31' })],
		'2026-06-01'
	);

	expect(rows[0].rateInForce).toBeNull();
});

test('a card that has not started yet does not count as in force', () => {
	const rows = contractRows(
		[contract({ id: 'c1' })],
		[card({ contractId: 'c1', validFrom: '2026-09-01' })],
		'2026-06-01'
	);

	expect(rows[0].rateInForce).toBeNull();
});

test('the boundaries of a validity period are inclusive on both ends', () => {
	const bounded = [card({ contractId: 'c1', validFrom: '2026-04-01', validTo: '2026-04-30' })];

	expect(
		contractRows([contract({ id: 'c1' })], bounded, '2026-04-01')[0].rateInForce
	).not.toBeNull();
	expect(
		contractRows([contract({ id: 'c1' })], bounded, '2026-04-30')[0].rateInForce
	).not.toBeNull();
	expect(contractRows([contract({ id: 'c1' })], bounded, '2026-05-01')[0].rateInForce).toBeNull();
});

test('a numeric amount arrives as a string from Postgres and is handed on as a number', () => {
	// `Intl` renders a string amount as NaN, so this is the difference
	// between a rate and a broken cell.
	const rows = contractRows(
		[contract({ id: 'c1' })],
		[card({ contractId: 'c1', amount: '1234.56' })],
		'2026-06-01'
	);

	expect(rows[0].rateInForce).toEqual({ amount: 1234.56, unit: 'day' });
});

test('the facts that block work are carried through per row, not defaulted', () => {
	const rows = contractRows(
		[
			contract({ id: 'c1', requiresPriorApproval: true, mailFolder: 'Clients/Acme' }),
			contract({ id: 'c2', requiresPriorApproval: false, mailFolder: null })
		],
		[],
		'2026-06-01'
	);

	expect(rows.map((row) => [row.requiresPriorApproval, row.mailFolder])).toEqual([
		[true, 'Clients/Acme'],
		[false, null]
	]);
});

test('an instance with no contracts produces no rows rather than throwing', () => {
	expect(contractRows([], [], '2026-06-01')).toEqual([]);
});
