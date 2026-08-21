import { afterAll, expect, test } from 'vitest';
import { client as pool } from '$lib/server/db';
import { listClients } from '$lib/server/repositories/client';
import { load } from './+page.server';
import type { PageData, PageServerLoad } from './$types';

// #321's day-entry empty state needs to know, once there is no active
// contract to record against, where "add one" goes: `/clients/new` when
// there is no client at all yet, or a client's own contract-new page when
// one exists. `load` resolves that as `firstClientId` — the
// alphabetically-first client (`listClients`'s own order), or `null` — and
// `+page.svelte` picks the link from it.
//
// The seeded shared database always has active contracts (AGENTS.md), so
// the empty branch itself never renders here; that is proven in a browser
// against data planted for the purpose, per #321's own "how to verify",
// not by emptying this shared instance. What is provable without touching
// the database is the shape `load` hands the page: `firstClientId` tracks
// `listClients()` exactly, read-only, no fixture required.

afterAll(async () => {
	await pool.end();
});

function event(url: string) {
	return { url: new URL(url) } as unknown as Parameters<PageServerLoad>[0];
}

// `load`'s own declared type is `PageServerLoad`, whose `OutputData`
// default is the app-wide `App.PageData` shape, not this route's actual
// return — SvelteKit's generated `$types.d.ts` gets the real one via a
// compiled proxy module, which importing `load` straight from the source
// file here does not. Casting through `PageData`, the same generated type
// `+page.svelte` consumes, recovers it without widening what's asserted.
async function loadPage(url: string) {
	return (await load(event(url))) as PageData;
}

test('firstClientId is the alphabetically-first client id, or null when there are none', async () => {
	const [clients, data] = await Promise.all([listClients(), loadPage('http://localhost/day/new')]);

	expect(data.firstClientId).toBe(clients[0]?.id ?? null);
});

test('defaultContractId, when set, always names one of the offered contracts', async () => {
	const data = await loadPage('http://localhost/day/new');

	if (data.contracts.length === 0) {
		expect(data.defaultContractId).toBe('');
	} else {
		expect(data.contracts.some((contract) => contract.id === data.defaultContractId)).toBe(true);
	}
});

test('approvalCountByContract answers for every contract the form offers (#417)', async () => {
	// The banner used to claim "no written approval for {date} on this
	// contract" from a condition that only knew whether *this entry* carried
	// one - a statement about the ledger nothing had checked, and false on
	// the live instance the day somebody read it. This count is what tells
	// "none exists" apart from "none linked", so the form cannot say the
	// first when the second is true.
	const data = await loadPage('http://localhost/day/new');

	for (const contract of data.contracts) {
		const count = data.approvalCountByContract[contract.id];
		expect(count, `contract ${contract.id} has no count`).toBeTypeOf('number');
		expect(count).toBeGreaterThanOrEqual(0);
	}
	// And nothing else: a count for a contract the form does not offer would
	// be a fact the page cannot use and a row somebody else's contract paid
	// for reading.
	expect(Object.keys(data.approvalCountByContract).sort()).toEqual(
		data.contracts.map((contract) => contract.id).sort()
	);
});
