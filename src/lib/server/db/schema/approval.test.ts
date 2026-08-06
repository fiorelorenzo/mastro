import { eq } from 'drizzle-orm';
import { afterAll, expect, test } from 'vitest';
import { client as pool, db } from '$lib/server/db';
import { approval, client, contract, document } from './index';
import type { ApprovalOrigin } from './approval';
import type { ExpensePolicy, PaymentTerms } from './contract';

// Needs a migrated database: `pnpm db:up && pnpm db:migrate`.
// Real database, work done inside a transaction that is always rolled back —
// see `src/lib/server/db/set-updated-at.test.ts` for the pattern. These
// exercise the constraints in `0010_approval_constraints.sql`, the
// database-level half of #22's acceptance.

afterAll(async () => {
	await pool.end();
});

let counter = 0;

async function insertContractAndDocument(tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) {
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
			expensePolicy: { kind: 'not_reimbursed' } satisfies ExpensePolicy
		})
		.returning();
	const [documentRow] = await tx
		.insert(document)
		.values({
			hash: 'b'.repeat(64),
			mime: 'message/rfc822',
			size: 512,
			originalName: 'approval.eml',
			provenance: 'mail' as const,
			contractId: contractRow.id,
			confidential: true,
			ownerType: 'contract' as const,
			ownerId: contractRow.id
		})
		.returning();
	return { contractRow, documentRow };
}

function approvalFields(
	contractId: string,
	documentId: string,
	overrides: Partial<typeof approval.$inferInsert> = {}
) {
	return {
		contractId,
		channel: 'email' as const,
		sender: 'client@example.com',
		receivedAt: new Date('2024-05-01T09:00:00Z'),
		messageId: '<abc123@example.com>',
		documentId,
		excerpt: 'Yes, please go ahead with the 3 days next week.',
		origin: { kind: 'manual' } satisfies ApprovalOrigin,
		...overrides
	};
}

test('a well-formed manual approval is accepted', async () => {
	await expect(
		db.transaction(async (tx) => {
			const { contractRow, documentRow } = await insertContractAndDocument(tx);
			const [row] = await tx
				.insert(approval)
				.values(approvalFields(contractRow.id, documentRow.id))
				.returning();
			expect(row.sender).toBe('client@example.com');

			tx.rollback();
		})
	).rejects.toThrow();
});

test('an agent origin without a proposal reference is rejected by the database', async () => {
	await expect(
		db.transaction(async (tx) => {
			const { contractRow, documentRow } = await insertContractAndDocument(tx);

			await expect(
				tx.insert(approval).values(
					approvalFields(contractRow.id, documentRow.id, {
						origin: { kind: 'agent', proposalReference: '' } satisfies ApprovalOrigin
					})
				)
			).rejects.toMatchObject({ code: '23514', constraint_name: 'approval_origin_shape' });

			tx.rollback();
		})
	).rejects.toThrow();
});

test('an agent origin with a proposal reference is accepted', async () => {
	await expect(
		db.transaction(async (tx) => {
			const { contractRow, documentRow } = await insertContractAndDocument(tx);
			const [row] = await tx
				.insert(approval)
				.values(
					approvalFields(contractRow.id, documentRow.id, {
						origin: { kind: 'agent', proposalReference: 'proposal-1' } satisfies ApprovalOrigin
					})
				)
				.returning();
			expect(row.origin).toEqual({ kind: 'agent', proposalReference: 'proposal-1' });

			tx.rollback();
		})
	).rejects.toThrow();
});

test('a blank excerpt is rejected by the database', async () => {
	await expect(
		db.transaction(async (tx) => {
			const { contractRow, documentRow } = await insertContractAndDocument(tx);

			await expect(
				tx
					.insert(approval)
					.values(approvalFields(contractRow.id, documentRow.id, { excerpt: '   ' }))
			).rejects.toMatchObject({ code: '23514', constraint_name: 'approval_excerpt_not_blank' });

			tx.rollback();
		})
	).rejects.toThrow();
});

test('an approval cannot be updated after creation; the attempt fails', async () => {
	await expect(
		db.transaction(async (tx) => {
			const { contractRow, documentRow } = await insertContractAndDocument(tx);
			const [row] = await tx
				.insert(approval)
				.values(approvalFields(contractRow.id, documentRow.id))
				.returning();

			await expect(
				tx
					.update(approval)
					.set({ excerpt: 'a different excerpt entirely' })
					.where(eq(approval.id, row.id))
			).rejects.toThrow(/immutable once written/);

			tx.rollback();
		})
	).rejects.toThrow();
});

test('an unreferenced approval can be deleted; nothing in #22 blocks that', async () => {
	await expect(
		db.transaction(async (tx) => {
			const { contractRow, documentRow } = await insertContractAndDocument(tx);
			const [row] = await tx
				.insert(approval)
				.values(approvalFields(contractRow.id, documentRow.id))
				.returning();

			await tx.delete(approval).where(eq(approval.id, row.id));
			const remaining = await tx.select().from(approval).where(eq(approval.id, row.id));
			expect(remaining).toHaveLength(0);

			tx.rollback();
		})
	).rejects.toThrow();
});
