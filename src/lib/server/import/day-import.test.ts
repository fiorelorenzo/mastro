import { describe, expect, test } from 'vitest';
import type { PriceableRateCard } from '$lib/server/domain/work-unit-pricing';
import {
	buildDayImportReview,
	dayImportKey,
	isDayImportMappingComplete,
	parseImportedDate,
	parseImportedQuantity,
	parseImportedState,
	suggestDayImportColumnMapping,
	type CompleteDayImportColumnMapping,
	type DayImportCandidateClient,
	type DayImportRejectedRow,
	type DayImportValidRow
} from './day-import';

const MAPPING: CompleteDayImportColumnMapping = {
	date: 0,
	quantity: 1,
	scope: 2,
	client: 3,
	contract: 4,
	state: 5
};

const DAY_RATE_CARD: PriceableRateCard = {
	id: 'card-1',
	validFrom: '2025-01-01',
	validTo: null,
	kind: 'daily',
	amount: 700,
	unit: 'day',
	allowedFractions: [1, 0.5],
	minimumHours: null,
	disbursementPeriod: null
};

function client(overrides: Partial<DayImportCandidateClient> = {}): DayImportCandidateClient {
	return {
		id: 'client-1',
		legalName: 'Nordwind Logistics S.r.l.',
		activeContracts: [
			{
				id: 'contract-1',
				title: 'Consulenza operativa — Nordwind Logistics',
				currency: 'EUR',
				requiresPriorApproval: true
			}
		],
		...overrides
	};
}

function row(
	date: string,
	quantity: string,
	scope: string,
	clientName: string,
	contract = '',
	state = ''
): readonly string[] {
	return [date, quantity, scope, clientName, contract, state];
}

function expectValid(outcome: { kind: string }): DayImportValidRow {
	if (outcome.kind !== 'valid') throw new Error(`expected a valid row, got ${outcome.kind}`);
	return outcome as DayImportValidRow;
}

function expectRejected(outcome: { kind: string }): DayImportRejectedRow {
	if (outcome.kind !== 'rejected') throw new Error(`expected a rejected row, got ${outcome.kind}`);
	return outcome as DayImportRejectedRow;
}

describe('parseImportedDate', () => {
	test('accepts a real ISO calendar date', () => {
		expect(parseImportedDate('2026-03-10')).toBe('2026-03-10');
	});

	test('rejects a date shaped right but not real (30 February)', () => {
		expect(parseImportedDate('2026-02-30')).toBeNull();
	});

	test('rejects garbage text', () => {
		expect(parseImportedDate('not-a-date')).toBeNull();
	});

	test('rejects a non-ISO format (day/month/year)', () => {
		expect(parseImportedDate('10/03/2026')).toBeNull();
	});
});

describe('parseImportedQuantity', () => {
	test('accepts a plain positive decimal', () => {
		expect(parseImportedQuantity('0.5')).toBe(0.5);
	});

	test('accepts a comma decimal separator when there is no dot already', () => {
		expect(parseImportedQuantity('1,5')).toBe(1.5);
	});

	test('rejects zero and negative values', () => {
		expect(parseImportedQuantity('0')).toBeNull();
		expect(parseImportedQuantity('-1')).toBeNull();
	});

	test('rejects non-numeric text', () => {
		expect(parseImportedQuantity('one day')).toBeNull();
	});

	test('rejects an empty cell', () => {
		expect(parseImportedQuantity('  ')).toBeNull();
	});
});

describe('parseImportedState', () => {
	test('defaults a blank cell to worked', () => {
		expect(parseImportedState('')).toBe('worked');
	});

	test('accepts worked and proposed, case-insensitively', () => {
		expect(parseImportedState('Worked')).toBe('worked');
		expect(parseImportedState('PROPOSED')).toBe('proposed');
	});

	test('rejects anything else', () => {
		expect(parseImportedState('done')).toBeNull();
	});
});

describe('suggestDayImportColumnMapping', () => {
	test('matches the common English header names', () => {
		const mapping = suggestDayImportColumnMapping(['date', 'quantity', 'scope', 'client']);
		expect(mapping).toEqual({
			date: 0,
			quantity: 1,
			scope: 2,
			client: 3,
			contract: null,
			state: null
		});
	});

	test('matches Italian header names the same way', () => {
		const mapping = suggestDayImportColumnMapping([
			'data',
			'quantità',
			'oggetto',
			'cliente',
			'contratto',
			'stato'
		]);
		expect(mapping).toEqual({ date: 0, quantity: 1, scope: 2, client: 3, contract: 4, state: 5 });
	});

	test('leaves a field unmapped when nothing matches, never a guess', () => {
		const mapping = suggestDayImportColumnMapping(['when', 'qty', 'scope', 'client']);
		expect(mapping.date).toBeNull();
	});
});

describe('isDayImportMappingComplete', () => {
	test('true once every required field is mapped, optional ones may stay null', () => {
		expect(
			isDayImportMappingComplete({
				date: 0,
				quantity: 1,
				scope: 2,
				client: 3,
				contract: null,
				state: null
			})
		).toBe(true);
	});

	test('false when any required field is unmapped', () => {
		expect(
			isDayImportMappingComplete({
				date: null,
				quantity: 1,
				scope: 2,
				client: 3,
				contract: null,
				state: null
			})
		).toBe(false);
	});
});

describe('buildDayImportReview', () => {
	test('a clean row on a contract requiring prior approval becomes worked_without_approval, priced from its rate card', () => {
		const review = buildDayImportReview(
			[row('2026-03-10', '1', 'API migration', 'Nordwind Logistics S.r.l.')],
			MAPPING,
			[client()],
			new Map([['contract-1', [DAY_RATE_CARD]]])
		);
		expect(review.totalRows).toBe(1);
		const outcome = expectValid(review.outcomes[0]);
		expect(outcome.contractId).toBe('contract-1');
		expect(outcome.requestedState).toBe('worked');
		expect(outcome.resultingState).toBe('worked_without_approval');
		expect(outcome.previewAmount).toBe(700);
		expect(outcome.currency).toBe('EUR');
	});

	test('a half day prices to half the daily rate', () => {
		const review = buildDayImportReview(
			[row('2026-03-10', '0.5', 'Half day of QA', 'Nordwind Logistics S.r.l.')],
			MAPPING,
			[client()],
			new Map([['contract-1', [DAY_RATE_CARD]]])
		);
		expect(expectValid(review.outcomes[0]).previewAmount).toBe(350);
	});

	test('a contract that does not require approval stays worked', () => {
		const noApproval = client({
			activeContracts: [
				{
					id: 'contract-2',
					title: 'Advisory continuativa',
					currency: 'EUR',
					requiresPriorApproval: false
				}
			]
		});
		const review = buildDayImportReview(
			[row('2026-03-10', '1', 'Advisory session', 'Nordwind Logistics S.r.l.')],
			MAPPING,
			[noApproval],
			new Map()
		);
		expect(expectValid(review.outcomes[0]).resultingState).toBe('worked');
	});

	test('an explicit proposed state is never redirected into worked_without_approval', () => {
		const review = buildDayImportReview(
			[row('2026-03-10', '1', 'API migration', 'Nordwind Logistics S.r.l.', '', 'proposed')],
			MAPPING,
			[client()],
			new Map()
		);
		const outcome = expectValid(review.outcomes[0]);
		expect(outcome.requestedState).toBe('proposed');
		expect(outcome.resultingState).toBe('proposed');
	});

	test('no rate card in force on the date previews as unpriced, not rejected', () => {
		const review = buildDayImportReview(
			[row('2026-03-10', '1', 'API migration', 'Nordwind Logistics S.r.l.')],
			MAPPING,
			[client()],
			new Map()
		);
		expect(expectValid(review.outcomes[0]).previewAmount).toBeNull();
	});

	test('a fully blank line is not counted as a row at all', () => {
		const review = buildDayImportReview(
			[
				row('2026-03-10', '1', 'API migration', 'Nordwind Logistics S.r.l.'),
				['', '', '', '', '', '']
			],
			MAPPING,
			[client()],
			new Map()
		);
		expect(review.totalRows).toBe(1);
		expect(review.outcomes).toHaveLength(1);
	});

	test('a missing required field names which one, and the row is still numbered', () => {
		const review = buildDayImportReview(
			[row('', '1', 'API migration', 'Nordwind Logistics S.r.l.')],
			MAPPING,
			[client()],
			new Map()
		);
		const rejected = expectRejected(review.outcomes[0]);
		expect(rejected.rowNumber).toBe(1);
		expect(rejected.reason).toEqual({ kind: 'missing_field', field: 'date' });
	});

	test('an unreal date is rejected and named', () => {
		const review = buildDayImportReview(
			[row('2026-02-30', '1', 'API migration', 'Nordwind Logistics S.r.l.')],
			MAPPING,
			[client()],
			new Map()
		);
		expect(expectRejected(review.outcomes[0]).reason).toEqual({
			kind: 'invalid_date',
			raw: '2026-02-30'
		});
	});

	test('a non-numeric quantity is rejected and named', () => {
		const review = buildDayImportReview(
			[row('2026-03-10', 'two', 'API migration', 'Nordwind Logistics S.r.l.')],
			MAPPING,
			[client()],
			new Map()
		);
		expect(expectRejected(review.outcomes[0]).reason).toEqual({
			kind: 'invalid_quantity',
			raw: 'two'
		});
	});

	test('an unrecognised state value is rejected and named', () => {
		const review = buildDayImportReview(
			[row('2026-03-10', '1', 'API migration', 'Nordwind Logistics S.r.l.', '', 'maybe')],
			MAPPING,
			[client()],
			new Map()
		);
		expect(expectRejected(review.outcomes[0]).reason).toEqual({
			kind: 'invalid_state',
			raw: 'maybe'
		});
	});

	test('a client name matching nobody on record is rejected and named', () => {
		const review = buildDayImportReview(
			[row('2026-03-10', '1', 'API migration', 'Ghost Client S.r.l.')],
			MAPPING,
			[client()],
			new Map()
		);
		expect(expectRejected(review.outcomes[0]).reason).toEqual({
			kind: 'unknown_client',
			raw: 'Ghost Client S.r.l.'
		});
	});

	test('client name matching is exact but case- and whitespace-insensitive', () => {
		const review = buildDayImportReview(
			[row('2026-03-10', '1', 'API migration', '  nordwind logistics s.r.l.  ')],
			MAPPING,
			[client()],
			new Map()
		);
		expect(review.outcomes[0].kind).toBe('valid');
	});

	test('a client with no active contract at all is rejected and named', () => {
		const review = buildDayImportReview(
			[row('2026-03-10', '1', 'API migration', 'Nordwind Logistics S.r.l.')],
			MAPPING,
			[client({ activeContracts: [] })],
			new Map()
		);
		expect(expectRejected(review.outcomes[0]).reason).toEqual({
			kind: 'no_active_contract',
			clientLegalName: 'Nordwind Logistics S.r.l.'
		});
	});

	test('a client with more than one active contract and no contract column value is ambiguous', () => {
		const twoContracts = client({
			activeContracts: [
				{
					id: 'contract-1',
					title: 'First engagement',
					currency: 'EUR',
					requiresPriorApproval: false
				},
				{
					id: 'contract-2',
					title: 'Second engagement',
					currency: 'EUR',
					requiresPriorApproval: false
				}
			]
		});
		const review = buildDayImportReview(
			[row('2026-03-10', '1', 'API migration', 'Nordwind Logistics S.r.l.')],
			MAPPING,
			[twoContracts],
			new Map()
		);
		expect(expectRejected(review.outcomes[0]).reason).toEqual({
			kind: 'ambiguous_contract',
			clientLegalName: 'Nordwind Logistics S.r.l.'
		});
	});

	test('an explicit contract column resolves the ambiguity', () => {
		const twoContracts = client({
			activeContracts: [
				{
					id: 'contract-1',
					title: 'First engagement',
					currency: 'EUR',
					requiresPriorApproval: false
				},
				{
					id: 'contract-2',
					title: 'Second engagement',
					currency: 'EUR',
					requiresPriorApproval: false
				}
			]
		});
		const review = buildDayImportReview(
			[row('2026-03-10', '1', 'API migration', 'Nordwind Logistics S.r.l.', 'Second engagement')],
			MAPPING,
			[twoContracts],
			new Map()
		);
		expect(expectValid(review.outcomes[0]).contractId).toBe('contract-2');
	});

	test('a contract column value matching no active contract is rejected and named', () => {
		const review = buildDayImportReview(
			[
				row(
					'2026-03-10',
					'1',
					'API migration',
					'Nordwind Logistics S.r.l.',
					'Nonexistent engagement'
				)
			],
			MAPPING,
			[client()],
			new Map()
		);
		expect(expectRejected(review.outcomes[0]).reason).toEqual({
			kind: 'unknown_contract',
			raw: 'Nonexistent engagement',
			clientLegalName: 'Nordwind Logistics S.r.l.'
		});
	});

	test('a date already carrying a live day in the database is rejected as already recorded, never re-created', () => {
		const review = buildDayImportReview(
			[row('2026-03-10', '1', 'API migration', 'Nordwind Logistics S.r.l.')],
			MAPPING,
			[client()],
			new Map(),
			new Map([[dayImportKey('contract-1', '2026-03-10'), 'invoiced']])
		);
		expect(expectRejected(review.outcomes[0]).reason).toEqual({
			kind: 'already_recorded',
			existingState: 'invoiced'
		});
	});

	test('two rows importing the same contract and date collide: the first is valid, the second names the first as a duplicate', () => {
		const review = buildDayImportReview(
			[
				row('2026-03-10', '1', 'Morning work', 'Nordwind Logistics S.r.l.'),
				row('2026-03-10', '0.5', 'Afternoon work', 'Nordwind Logistics S.r.l.')
			],
			MAPPING,
			[client()],
			new Map()
		);
		expect(review.outcomes[0].kind).toBe('valid');
		const rejected = expectRejected(review.outcomes[1]);
		expect(rejected.rowNumber).toBe(2);
		expect(rejected.reason).toEqual({ kind: 'duplicate_in_batch', firstRowNumber: 1 });
	});

	test('one bad row never excludes the rest of the file: a malformed row sits between two valid ones', () => {
		const review = buildDayImportReview(
			[
				row('2026-03-10', '1', 'Day one', 'Nordwind Logistics S.r.l.'),
				row('not-a-date', '1', 'Bad day', 'Nordwind Logistics S.r.l.'),
				row('2026-03-11', '1', 'Day three', 'Nordwind Logistics S.r.l.')
			],
			MAPPING,
			[client()],
			new Map()
		);
		expect(review.outcomes.map((outcome) => outcome.kind)).toEqual(['valid', 'rejected', 'valid']);
		expect(review.outcomes[1].rowNumber).toBe(2);
		expect(review.outcomes[2].rowNumber).toBe(3);
	});
});
