import { describe, expect, test } from 'vitest';
import { isPostgresConstraintViolation, isPostgresError } from './postgres-error';

class FakeDrizzleQueryError extends Error {
	constructor(
		message: string,
		public override cause: unknown
	) {
		super(message);
	}
}

test('matches a DrizzleQueryError wrapping the real Postgres error on .cause', () => {
	const error = new FakeDrizzleQueryError('Failed query', {
		code: '23505',
		constraint_name: 'client_tax_id_unique'
	});
	expect(isPostgresConstraintViolation(error, '23505', 'client_tax_id_unique')).toBe(true);
});

test('matches a raw Postgres-shaped error with no wrapper', () => {
	const error = { code: '23P01', constraint_name: 'rate_card_no_overlapping_validity' };
	expect(isPostgresConstraintViolation(error, '23P01', 'rate_card_no_overlapping_validity')).toBe(
		true
	);
});

test('rejects a matching code on a different constraint', () => {
	const error = new FakeDrizzleQueryError('Failed query', {
		code: '23505',
		constraint_name: 'some_other_unique_index'
	});
	expect(isPostgresConstraintViolation(error, '23505', 'client_tax_id_unique')).toBe(false);
});

test('rejects an unrelated error', () => {
	expect(isPostgresConstraintViolation(new Error('boom'), '23505', 'client_tax_id_unique')).toBe(
		false
	);
	expect(isPostgresConstraintViolation(null, '23505', 'client_tax_id_unique')).toBe(false);
});

describe('isPostgresError', () => {
	// The wrapper drizzle-orm puts around the driver's error, with the real
	// one on `.cause` — the same unwrapping the constraint check needs.
	function wrapped(cause: unknown): Error {
		return new Error('Failed query: insert into …', { cause });
	}

	test('a driver error is one, whatever it was about', () => {
		expect(isPostgresError(wrapped({ severity: 'ERROR', code: '23514' }))).toBe(true);
	});

	// The case that made this necessary: accepting a proposal whose source
	// message had no inbound_thread row threw here, in application code, and
	// the screen told the reviewer the database had rejected it.
	test('an application error is not, so nothing may blame the database for it', () => {
		expect(isPostgresError(new Error('document abc has no inbound thread'))).toBe(false);
	});

	test.each([[null], [undefined], ['a string'], [42], [{}]])('%p is not', (value) => {
		expect(isPostgresError(value)).toBe(false);
	});

	test('an object with a code but no severity is not a driver error', () => {
		expect(isPostgresError(wrapped({ code: 'ENOENT' }))).toBe(false);
	});
});
