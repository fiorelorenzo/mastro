// #46/#47. Needs a migrated database: `pnpm db:up && pnpm db:migrate`.
// Postgres work happens inside a transaction that is always rolled back,
// same pattern as `repositories/approval.test.ts`.
import { eq } from 'drizzle-orm';
import { afterAll, expect, test } from 'vitest';
import { client as pool, db } from '$lib/server/db';
import { client, contract } from '$lib/server/db/schema';
import { confirmClientContractProposal } from './confirm';
import type { ClientProposal, ContractProposal } from './client-match';

afterAll(async () => {
	await pool.end();
});

function clientProposal(overrides: Partial<ClientProposal> = {}): ClientProposal {
	return {
		legalName: 'Rossi Consulting srl',
		taxId: 'IT01234567890',
		vatId: null,
		country: 'IT',
		addressLine1: 'Via Roma 1',
		addressLine2: null,
		addressCity: 'Milano',
		addressPostalCode: '20100',
		addressRegion: null,
		noticeChannel: 'email',
		...overrides
	};
}

function contractProposal(overrides: Partial<ContractProposal> = {}): ContractProposal {
	return {
		title: 'Rossi Consulting srl',
		signedDocumentReference: null,
		startsOn: '2024-01-15',
		endsOn: null,
		renewalType: 'none',
		renewalNoticeDays: null,
		paymentTerms: { kind: 'net', days: 30 },
		invoicingCadence: 'on_completion',
		currency: 'EUR',
		taxTreatment: '',
		terminationNoticeDays: 0,
		requiresPriorApproval: false,
		expensePolicy: { kind: 'not_reimbursed' },
		status: 'active',
		...overrides
	};
}

test('confirming a proposal writes exactly one client and one contract, linked', async () => {
	await expect(
		db.transaction(async (tx) => {
			const { clientId, contractId } = await confirmClientContractProposal(
				clientProposal(),
				contractProposal(),
				tx
			);

			const [clientRow] = await tx.select().from(client).where(eq(client.id, clientId));
			expect(clientRow.legalName).toBe('Rossi Consulting srl');
			expect(clientRow.taxId).toBe('IT01234567890');
			expect(clientRow.noticeChannel).toBe('email');

			const [contractRow] = await tx.select().from(contract).where(eq(contract.id, contractId));
			expect(contractRow.clientId).toBe(clientId);
			expect(contractRow.title).toBe('Rossi Consulting srl');
			expect(contractRow.status).toBe('active');
			expect(contractRow.renewalType).toBe('none');

			tx.rollback();
		})
	).rejects.toThrow();
});

test('a duplicate tax id surfaces as the same unique-constraint violation client creation hits', async () => {
	await expect(
		db.transaction(async (tx) => {
			await confirmClientContractProposal(clientProposal(), contractProposal(), tx);
			await expect(
				confirmClientContractProposal(clientProposal(), contractProposal(), tx)
			).rejects.toThrow();
			tx.rollback();
		})
	).rejects.toThrow();
});

test('a failed contract insert leaves no orphan client (one transaction, both inserts)', async () => {
	// No ambient `tx` here on purpose: `confirmClientContractProposal` opens
	// its own real transaction on the pool, so its rollback is real too,
	// and the absence of the client row can be checked with a plain query
	// afterwards rather than one sharing (and being aborted by) the same
	// failed transaction.
	await expect(
		confirmClientContractProposal(
			clientProposal(),
			// A negative notice period violates
			// contract_termination_notice_days_non_negative.
			contractProposal({ terminationNoticeDays: -1 })
		)
	).rejects.toThrow();

	const rows = await db.select().from(client).where(eq(client.taxId, 'IT01234567890'));
	expect(rows).toEqual([]);
});
