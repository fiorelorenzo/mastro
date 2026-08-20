import { eq } from 'drizzle-orm';
import { afterAll, expect, test } from 'vitest';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { client as pool, db } from '$lib/server/db';
import { client, contract, document } from '$lib/server/db/schema';
import type { PaymentTerms } from '$lib/server/db/schema/contract';
import { getContractDocuments, getContractsWithClient, setContractStatus } from './contract';

// Needs a migrated database: `pnpm db:up && pnpm db:migrate`. Postgres work
// happens inside a transaction that is always rolled back, same pattern as
// the other repository tests. `document` rows are inserted directly, not
// through `storeDocument`, since none of this exercises the blob store —
// the same shortcut `repositories/proposal.test.ts`'s `insertDocument`
// helper takes.

afterAll(async () => {
	await pool.end();
});

async function insertContract(tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) {
	const [clientRow] = await tx
		.insert(client)
		.values({
			legalName: `Test Client ${crypto.randomUUID()}`,
			taxId: `TEST-TAX-${crypto.randomUUID()}`,
			country: 'IT',
			addressLine1: 'Via Roma 1',
			addressCity: 'Milano',
			addressPostalCode: '20100',
			noticeChannel: 'email' as const
		})
		.returning();
	const [contractRow] = await tx
		.insert(contract)
		.values({
			clientId: clientRow.id,
			title: 'Test contract',
			startsOn: '2024-01-01',
			renewalType: 'none' as const,
			terminationNoticeDays: 30,
			paymentTerms: { kind: 'net', days: 30 } satisfies PaymentTerms,
			invoicingCadence: 'monthly' as const,
			currency: 'EUR',
			taxTreatment: 'generic',
			expensePolicy: { kind: 'not_reimbursed' },
			requiresPriorApproval: false
		})
		.returning();
	return contractRow;
}

test('#215: a document still owned by the contract itself is reachable, and a contract with none returns an empty list', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx);

		// A raw inbound message the mail poller archived (`mail/poll.ts`'s
		// own `ownerType: 'contract'`) and nothing has re-pointed at an
		// approval, an expense or an invoice yet — the "consent-era
		// documents that remain" #215's brief names.
		expect(await getContractDocuments(contractRow.id, tx)).toEqual([]);

		const [documentRow] = await tx
			.insert(document)
			.values({
				hash: 'a'.repeat(64),
				mime: 'message/rfc822',
				size: 128,
				originalName: 'thread.eml',
				provenance: 'mail',
				contractId: contractRow.id,
				confidential: true,
				ownerType: 'contract',
				ownerId: contractRow.id
			})
			.returning();

		const documents = await getContractDocuments(contractRow.id, tx);
		expect(documents.map((d) => d.id)).toEqual([documentRow.id]);
		expect(documents[0].originalName).toBe('thread.eml');

		// Owned by a different contract entirely — never leaks across the
		// polymorphic link's `ownerId`.
		const otherContract = await insertContract(tx);
		expect(await getContractDocuments(otherContract.id, tx)).toEqual([]);
	});
});

test('getContractsWithClient returns every requested contract with its client eagerly joined, and nothing for an id never inserted', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractA = await insertContract(tx);
		const contractB = await insertContract(tx);

		const rows = await getContractsWithClient(
			[contractA.id, contractB.id, crypto.randomUUID()],
			tx
		);
		expect(rows.map((row) => row.id).sort()).toEqual([contractA.id, contractB.id].sort());

		const foundA = rows.find((row) => row.id === contractA.id);
		expect(foundA?.client.id).toBe(contractA.clientId);
		expect(foundA?.client.legalName).toBeTruthy();

		expect(await getContractsWithClient([], tx)).toEqual([]);
	});
});

// #377: activating a contract is the one status change with a shortcut, so
// the write behind that shortcut is worth pinning down. The bug this
// defends against is not subtle and would be catastrophic: an `update`
// without its `where` activates every contract in the ledger, and a draft
// contract is draft on purpose.
test('setContractStatus activates the contract it is given and leaves every other one alone', async () => {
	const result = await inRolledBackTransaction(async (tx) => {
		const target = await insertContract(tx);
		const bystander = await insertContract(tx);

		const returned = await setContractStatus(target.id, 'active', tx);

		const [targetAfter] = await tx.select().from(contract).where(eq(contract.id, target.id));
		const [bystanderAfter] = await tx.select().from(contract).where(eq(contract.id, bystander.id));
		return { returned, targetAfter, bystanderAfter, bystanderBefore: bystander.status };
	});

	expect(result.returned?.status).toBe('active');
	expect(result.targetAfter.status).toBe('active');
	expect(result.bystanderAfter.status).toBe(result.bystanderBefore);
});

test('setContractStatus answers null for a contract that does not exist', async () => {
	// The route errors 404 before ever calling this, so the honest contract
	// here is "no row, no lie" rather than a thrown error.
	const returned = await inRolledBackTransaction(async (tx) =>
		setContractStatus(crypto.randomUUID(), 'active', tx)
	);

	expect(returned).toBeNull();
});
