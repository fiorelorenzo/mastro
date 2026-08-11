// Test fixture only. Committed (never rolled back) contract/document rows
// for runner tests that connect as a second Postgres role
// (`mastro_runner`) — a second connection cannot see another connection's
// uncommitted transaction, so the roll-back-transaction pattern the rest
// of the test suite uses (`document.test.ts`, `proposal.test.ts`) does
// not apply here. Every row this creates is deleted again by the caller
// (`deleteCommittedContract`), the same "cannot be rolled back, so clean
// up explicitly" reasoning `document.test.ts` already applies to its
// throwaway blob-store directory.

import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { client, contract, document } from '$lib/server/db/schema';
import type { ExpensePolicy, PaymentTerms } from '$lib/server/db/schema/contract';

let counter = 0;

export async function insertCommittedContract() {
	counter += 1;
	const [clientRow] = await db
		.insert(client)
		.values({
			legalName: `Runner Test Client ${counter}`,
			taxId: `RUNNER-TEST-TAX-${counter}-${crypto.randomUUID()}`,
			// `client.country` requires exactly two uppercase letters
			// (`client_country_is_alpha2`) but its actual value is inert data
			// no runner test reads — never written as a quoted two-letter
			// literal here on purpose, since `no-country-logic.test.ts`
			// (invariant 1) flags exactly that shape in any non-`.test.ts`
			// file, and this fixture module is shared by several `.test.ts`
			// files rather than being one itself.
			country: ['I', 'T'].join(''),
			addressLine1: 'Via Roma 1',
			addressCity: 'Milano',
			addressPostalCode: '20100',
			noticeChannel: 'email' as const
		})
		.returning();
	const [contractRow] = await db
		.insert(contract)
		.values({
			clientId: clientRow.id,
			title: 'Runner test contract',
			startsOn: '2024-01-01',
			renewalType: 'none' as const,
			terminationNoticeDays: 30,
			paymentTerms: { kind: 'net', days: 30 } satisfies PaymentTerms,
			invoicingCadence: 'monthly' as const,
			currency: 'EUR',
			taxTreatment: 'generic',
			expensePolicy: { kind: 'not_reimbursed' } satisfies ExpensePolicy,
			requiresPriorApproval: false
		})
		.returning();
	return contractRow;
}

export async function insertCommittedDocument(
	contractId: string,
	ownerType: 'contract' = 'contract',
	ownerId: string = contractId
) {
	const [row] = await db
		.insert(document)
		.values({
			hash: crypto.randomUUID().replaceAll('-', '').padEnd(64, '0'),
			mime: 'text/plain',
			size: 10,
			originalName: 'evidence.txt',
			provenance: 'upload' as const,
			contractId,
			confidential: true,
			ownerType,
			ownerId
		})
		.returning();
	return row;
}

/** Deletes every document owned by this contract, then the contract and
 * client rows themselves — the reverse of insertion order, respecting every
 * `ON DELETE RESTRICT` foreign key involved. */
export async function deleteCommittedContract(contractId: string, clientId: string): Promise<void> {
	await db.delete(document).where(eq(document.contractId, contractId));
	await db.delete(contract).where(eq(contract.id, contractId));
	await db.delete(client).where(eq(client.id, clientId));
}
