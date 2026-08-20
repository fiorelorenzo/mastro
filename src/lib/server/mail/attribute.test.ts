import { afterAll, expect, test } from 'vitest';
import { client as pool } from '$lib/server/db';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { client, clientContact, contract } from '$lib/server/db/schema';
import type { PaymentTerms } from '$lib/server/db/schema/contract';
import { attributeBySender, knownSenderAddresses, normaliseAddress } from './attribute';

// Needs a migrated database: `pnpm db:up && pnpm db:migrate`. Every case runs
// inside a transaction that is rolled back, and every assertion is scoped to
// the ids the case itself created — the seeded demo instance has its own
// clients and contacts, and this must hold with them present.

afterAll(async () => {
	await pool.end();
});

type Tx = Parameters<Parameters<typeof import('$lib/server/db').db.transaction>[0]>[0];

async function insertClientWithContract(
	tx: Tx,
	email: string,
	options: { contracts?: number; status?: 'active' | 'draft' } = {}
) {
	const [clientRow] = await tx
		.insert(client)
		.values({
			legalName: `Attribution ${crypto.randomUUID()}`,
			taxId: `ATTR-${crypto.randomUUID()}`,
			country: 'IT',
			addressLine1: 'Via Test 1',
			addressCity: 'Milano',
			addressPostalCode: '20100'
		})
		.returning();
	await tx.insert(clientContact).values({
		clientId: clientRow.id,
		name: 'Contact',
		email,
		canApprove: true
	});
	const contractIds: string[] = [];
	for (let i = 0; i < (options.contracts ?? 1); i++) {
		const [contractRow] = await tx
			.insert(contract)
			.values({
				clientId: clientRow.id,
				title: `Contract ${i}`,
				startsOn: '2024-01-01',
				renewalType: 'none' as const,
				terminationNoticeDays: 30,
				paymentTerms: { kind: 'net', days: 30 } satisfies PaymentTerms,
				invoicingCadence: 'monthly' as const,
				currency: 'EUR',
				taxTreatment: 'generic',
				expensePolicy: { kind: 'not_reimbursed' },
				requiresPriorApproval: false,
				appliesSocialCharge: false,
				status: options.status ?? 'active'
			})
			.returning();
		contractIds.push(contractRow.id);
	}
	return { clientId: clientRow.id, contractIds };
}

test('a sender that matches one contact of a client with one active contract attributes to it', async () => {
	const result = await inRolledBackTransaction(async (tx) => {
		const { clientId, contractIds } = await insertClientWithContract(tx, 'ada@acme.example');
		return { attributed: await attributeBySender('ada@acme.example', tx), clientId, contractIds };
	});

	expect(result.attributed).toEqual({
		contractId: result.contractIds[0],
		clientId: result.clientId
	});
});

test('a client with two active contracts is ambiguous, and ambiguous means nobody', async () => {
	// The shape that makes guessing wrong: a retainer plus a project for the
	// same counterparty. Picking one would be a guess presented as a fact.
	const attributed = await inRolledBackTransaction(async (tx) => {
		await insertClientWithContract(tx, 'two@acme.example', { contracts: 2 });
		return attributeBySender('two@acme.example', tx);
	});

	expect(attributed).toBeNull();
});

test('a sender nobody knows attributes to nobody', async () => {
	const attributed = await inRolledBackTransaction(async (tx) =>
		attributeBySender('stranger@nowhere.example', tx)
	);

	expect(attributed).toBeNull();
});

test('a draft contract is not a candidate: this month\u2019s mail does not belong to it', async () => {
	const attributed = await inRolledBackTransaction(async (tx) => {
		await insertClientWithContract(tx, 'draft@acme.example', { status: 'draft' });
		return attributeBySender('draft@acme.example', tx);
	});

	expect(attributed).toBeNull();
});

test('matching is case-insensitive and reads the address out of a From header', async () => {
	const result = await inRolledBackTransaction(async (tx) => {
		const { contractIds } = await insertClientWithContract(tx, 'ada@acme.example');
		return {
			contractIds,
			angled: await attributeBySender('Ada Lovelace <Ada@Acme.example>', tx),
			bare: await attributeBySender('ADA@ACME.EXAMPLE', tx)
		};
	});

	expect(result.angled?.contractId).toBe(result.contractIds[0]);
	expect(result.bare?.contractId).toBe(result.contractIds[0]);
});

test('the known-sender set contains the addresses the ledger knows, and nothing invented', async () => {
	const result = await inRolledBackTransaction(async (tx) => {
		await insertClientWithContract(tx, 'known@acme.example');
		return await knownSenderAddresses(tx);
	});

	expect(result.has('known@acme.example')).toBe(true);
	expect(result.has('stranger@nowhere.example')).toBe(false);
});

test('an address is only an address when it has an @', () => {
	// The pre-filter compares against this, so a header that is not an
	// address at all must not become a lookup key that accidentally matches.
	expect(normaliseAddress('Ada Lovelace')).toBeNull();
	expect(normaliseAddress('')).toBeNull();
	expect(normaliseAddress(null)).toBeNull();
	expect(normaliseAddress('  Ada <ADA@Acme.example>  ')).toBe('ada@acme.example');
});
