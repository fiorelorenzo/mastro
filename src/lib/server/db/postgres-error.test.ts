import { expect, test } from 'vitest';
import { isPostgresConstraintViolation } from './postgres-error';

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
