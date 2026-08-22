import { isHttpError } from '@sveltejs/kit';
import { expect, test } from 'vitest';
import { requireUuidSearchParam } from './params';

// #390's query-param half: `?contractId=` cannot lean on a route matcher,
// so `requireUuidSearchParam` is the one line that decides instead of a
// query happening to throw. It never touches the database — no `await`,
// no import from `repositories/` — which is what keeps a malformed id and
// an unreachable database from ever landing on the same response: this
// function's own 404 fires before a caller's query is even built, so a
// real database failure downstream still surfaces as whatever it always
// did (a 500), never masked as a 404 by this check.

test('a malformed value 404s with the caller-supplied message, before any query could run', () => {
	const url = new URL('http://localhost/approvals/new?contractId=not-a-uuid');
	try {
		requireUuidSearchParam(url, 'contractId', 'contract not found');
		expect.unreachable('expected requireUuidSearchParam to throw');
	} catch (err) {
		if (!isHttpError(err, 404)) throw err;
		expect(err.body).toEqual({ message: 'contract not found' });
	}
});

test('a missing value 404s the same way a malformed one does — absence is not a database question either', () => {
	const url = new URL('http://localhost/approvals/new');
	try {
		requireUuidSearchParam(url, 'contractId', 'contract not found');
		expect.unreachable('expected requireUuidSearchParam to throw');
	} catch (err) {
		if (!isHttpError(err, 404)) throw err;
		expect(err.body).toEqual({ message: 'contract not found' });
	}
});

test('a well-formed uuid passes through unchanged, leaving the not-found-vs-malformed decision to the query', () => {
	const id = crypto.randomUUID();
	const url = new URL(`http://localhost/approvals/new?contractId=${id}`);
	expect(requireUuidSearchParam(url, 'contractId', 'contract not found')).toBe(id);
});
