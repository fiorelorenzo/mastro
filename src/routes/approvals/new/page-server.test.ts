import { isHttpError } from '@sveltejs/kit';
import { afterAll, expect, test } from 'vitest';
import { client as pool } from '$lib/server/db';
import * as m from '$lib/paraglide/messages';
import { load } from './+page.server';
import type { PageServerLoad } from './$types';

// #390: `?contractId=` is required here — there is no contract-less state
// this page renders — so a malformed or absent value must 404 with the
// route's own `contract_not_found` message, the same answer an unknown but
// well-formed id gets, rather than reaching `getContractWithClient` and
// having Postgres reject the malformed uuid as an uncaught 500.

afterAll(async () => {
	await pool.end();
});

function event(url: string) {
	return { url: new URL(url) } as unknown as Parameters<PageServerLoad>[0];
}

async function expectContractNotFound(url: string) {
	try {
		await load(event(url));
		expect.unreachable('expected load to throw a 404');
	} catch (err) {
		if (!isHttpError(err, 404)) throw err;
		expect(err.body).toEqual({ message: m.contract_not_found() });
	}
}

test('a malformed contractId 404s instead of reaching the database', async () => {
	await expectContractNotFound('http://localhost/approvals/new?contractId=not-a-uuid');
});

test('a missing contractId 404s the same way, never as "" handed to a query', async () => {
	await expectContractNotFound('http://localhost/approvals/new');
});

test('a well-formed but unknown contractId still 404s, through the ordinary not-found check', async () => {
	await expectContractNotFound(`http://localhost/approvals/new?contractId=${crypto.randomUUID()}`);
});
