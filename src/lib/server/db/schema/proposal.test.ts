import { eq } from 'drizzle-orm';
import { afterAll, expect, test } from 'vitest';
import { client as pool, db } from '$lib/server/db';
import { client, contract, document, proposal } from './index';
import type { ExpensePolicy, PaymentTerms } from './contract';

// Needs a migrated database: `pnpm db:up && pnpm db:migrate`.
// Real database, work done inside a transaction that is always rolled back —
// see `src/lib/server/db/set-updated-at.test.ts` for the pattern. These
// exercise `0028_proposal_constraints.sql`, the database-level half of
// #83's acceptance. `repositories/proposal.test.ts` covers the repository
// orchestration on top, including the "no bypass" proof.

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

async function insertDocument(
	tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
	contractId: string
) {
	const [row] = await tx
		.insert(document)
		.values({
			hash: 'e'.repeat(64),
			mime: 'message/rfc822',
			size: 256,
			originalName: 'approval.eml',
			provenance: 'mail' as const,
			contractId,
			confidential: true,
			ownerType: 'contract' as const,
			ownerId: contractId
		})
		.returning();
	return row;
}

function proposalFields(
	contractId: string,
	documentId: string,
	overrides: Partial<typeof proposal.$inferInsert> = {}
) {
	return {
		documentId,
		contractId,
		targetType: 'work_unit' as const,
		proposedFields: { date: '2024-06-10', quantity: 1, scope: 'API migration' },
		excerpt: 'ok for Monday',
		confidence: 0.9,
		...overrides
	};
}

test('a well-formed proposal is accepted, defaulting to pending with no decision', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx);
			const documentRow = await insertDocument(tx, contractRow.id);

			const [row] = await tx
				.insert(proposal)
				.values(proposalFields(contractRow.id, documentRow.id))
				.returning();

			expect(row.status).toBe('pending');
			expect(row.acceptedFields).toBeNull();
			expect(row.resultId).toBeNull();
			expect(row.decidedBy).toBeNull();
			expect(row.decidedAt).toBeNull();

			tx.rollback();
		})
	).rejects.toThrow();
});

test('a blank excerpt is rejected by the database', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx);
			const documentRow = await insertDocument(tx, contractRow.id);

			await expect(
				tx
					.insert(proposal)
					.values(proposalFields(contractRow.id, documentRow.id, { excerpt: '   ' }))
			).rejects.toMatchObject({ code: '23514', constraint_name: 'proposal_excerpt_not_blank' });

			tx.rollback();
		})
	).rejects.toThrow();
});

test('a confidence outside 0..1 is rejected by the database', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx);
			const documentRow = await insertDocument(tx, contractRow.id);

			await expect(
				tx
					.insert(proposal)
					.values(proposalFields(contractRow.id, documentRow.id, { confidence: 1.5 }))
			).rejects.toMatchObject({ code: '23514', constraint_name: 'proposal_confidence_range' });

			await expect(
				tx
					.insert(proposal)
					.values(proposalFields(contractRow.id, documentRow.id, { confidence: -0.1 }))
			).rejects.toMatchObject({ code: '23514', constraint_name: 'proposal_confidence_range' });

			tx.rollback();
		})
	).rejects.toThrow();
});

test('a target_type outside the known set is rejected by the database', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx);
			const documentRow = await insertDocument(tx, contractRow.id);

			await expect(
				tx
					.insert(proposal)
					.values(
						proposalFields(contractRow.id, documentRow.id, { targetType: 'invoice' as never })
					)
			).rejects.toMatchObject({ code: '23514', constraint_name: 'proposal_target_type_known' });

			tx.rollback();
		})
	).rejects.toThrow();
});

test('an accepted status with no decision recorded is rejected by the database', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx);
			const documentRow = await insertDocument(tx, contractRow.id);

			await expect(
				tx
					.insert(proposal)
					.values(proposalFields(contractRow.id, documentRow.id, { status: 'accepted' }))
			).rejects.toMatchObject({ code: '23514', constraint_name: 'proposal_decision_shape' });

			tx.rollback();
		})
	).rejects.toThrow();
});

test('a pending status carrying a decision is rejected by the database', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx);
			const documentRow = await insertDocument(tx, contractRow.id);

			await expect(
				tx.insert(proposal).values(
					proposalFields(contractRow.id, documentRow.id, {
						decidedBy: 'lorenzo@example.com',
						decidedAt: new Date()
					})
				)
			).rejects.toMatchObject({ code: '23514', constraint_name: 'proposal_decision_shape' });

			tx.rollback();
		})
	).rejects.toThrow();
});

test('the proposed fields, excerpt and confidence cannot change after creation', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx);
			const documentRow = await insertDocument(tx, contractRow.id);
			const [row] = await tx
				.insert(proposal)
				.values(proposalFields(contractRow.id, documentRow.id))
				.returning();

			await expect(
				tx
					.update(proposal)
					.set({ excerpt: 'a different sentence entirely' })
					.where(eq(proposal.id, row.id))
			).rejects.toThrow(/immutable after creation/);

			tx.rollback();
		})
	).rejects.toThrow();
});

test('a proposal can move from pending to accepted exactly once', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx);
			const documentRow = await insertDocument(tx, contractRow.id);
			const [row] = await tx
				.insert(proposal)
				.values(proposalFields(contractRow.id, documentRow.id))
				.returning();

			const [decided] = await tx
				.update(proposal)
				.set({
					status: 'accepted',
					acceptedFields: { date: '2024-06-10', quantity: 1, scope: 'API migration' },
					resultId: crypto.randomUUID(),
					decidedBy: 'lorenzo@example.com',
					decidedAt: new Date()
				})
				.where(eq(proposal.id, row.id))
				.returning();
			expect(decided.status).toBe('accepted');

			await expect(
				tx.update(proposal).set({ status: 'rejected' }).where(eq(proposal.id, row.id))
			).rejects.toThrow(/already been decided/);

			tx.rollback();
		})
	).rejects.toThrow();
});
