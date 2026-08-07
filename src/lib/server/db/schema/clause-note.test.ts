import { eq } from 'drizzle-orm';
import { afterAll, expect, test } from 'vitest';
import { client as pool, db } from '$lib/server/db';
import { clauseNote, client, contract } from './index';
import type { ExpensePolicy, PaymentTerms } from './contract';

// Needs a migrated database: `pnpm db:up && pnpm db:migrate`.
// Real database, work done inside a transaction that is always rolled back —
// see `src/lib/server/db/set-updated-at.test.ts` for the pattern. This is
// the database-level half of #20's acceptance: a clause note attaches to a
// contract and the constraints in `0019_expense_and_clause_note_constraints.sql`
// hold even if application code never checked.

afterAll(async () => {
	await pool.end();
});

let counter = 0;

async function insertContract(tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) {
	counter += 1;
	const [clientRow] = await tx
		.insert(client)
		.values({
			legalName: `Test Client ${counter}`,
			taxId: `TEST-TAX-${counter}`,
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
			renewalType: 'counterparty_option' as const,
			renewalNoticeDays: 30,
			endsOn: '2024-12-31',
			terminationNoticeDays: 30,
			paymentTerms: { kind: 'net', days: 30 } satisfies PaymentTerms,
			invoicingCadence: 'monthly' as const,
			currency: 'EUR',
			taxTreatment: 'generic',
			expensePolicy: { kind: 'not_reimbursed' } satisfies ExpensePolicy
		})
		.returning();
	return contractRow;
}

test('a well-formed clause note attaches to its contract', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx);

			const [note] = await tx
				.insert(clauseNote)
				.values({
					contractId: contractRow.id,
					clauseReference: 'Art. 8.3',
					verbatimText:
						'The agreement terminates unless renewed; either party may refuse renewal upon one month notice.',
					interpretationAdopted:
						'Read as counterparty_option: the client may refuse renewal with 30 days notice.',
					notes: 'Confirmed by the client in writing on 2024-01-15.'
				})
				.returning();

			expect(note.contractId).toBe(contractRow.id);

			const notes = await tx
				.select()
				.from(clauseNote)
				.where(eq(clauseNote.contractId, contractRow.id));
			expect(notes).toHaveLength(1);

			tx.rollback();
		})
	).rejects.toThrow();
});

test('a blank clause_reference is rejected by the database', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx);
			await tx.insert(clauseNote).values({
				contractId: contractRow.id,
				clauseReference: '   ',
				verbatimText: 'text',
				interpretationAdopted: 'reading'
			});
			tx.rollback();
		})
	).rejects.toThrow();
});

test('a blank verbatim_text is rejected by the database', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx);
			await tx.insert(clauseNote).values({
				contractId: contractRow.id,
				clauseReference: 'Art. 8.3',
				verbatimText: '',
				interpretationAdopted: 'reading'
			});
			tx.rollback();
		})
	).rejects.toThrow();
});

test('a blank interpretation_adopted is rejected by the database', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx);
			await tx.insert(clauseNote).values({
				contractId: contractRow.id,
				clauseReference: 'Art. 8.3',
				verbatimText: 'text',
				interpretationAdopted: ''
			});
			tx.rollback();
		})
	).rejects.toThrow();
});
