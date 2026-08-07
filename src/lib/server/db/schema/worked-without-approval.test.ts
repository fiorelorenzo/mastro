import { eq } from 'drizzle-orm';
import { afterAll, expect, test } from 'vitest';
import { client as pool, db } from '$lib/server/db';
import { approval, client, contract, document, workUnit, workUnitTransition } from './index';
import type { ApprovalOrigin } from './approval';
import type { ExpensePolicy, PaymentTerms } from './contract';

// Needs a migrated database: `pnpm db:up && pnpm db:migrate`.
// Real database, work done inside a transaction that is always rolled back —
// see `src/lib/server/db/set-updated-at.test.ts` for the pattern. These
// exercise `0013_worked_without_approval.sql`, the database-level half of
// #23's acceptance: the automatic entry into the risk state, the alert
// engine's feed, and the automatic recovery once a late approval lands.

afterAll(async () => {
	await pool.end();
});

let counter = 0;

async function insertContract(
	tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
	requiresPriorApproval: boolean
) {
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
			requiresPriorApproval
		})
		.returning();
	return contractRow;
}

async function insertApproval(
	tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
	contractId: string
) {
	const [documentRow] = await tx
		.insert(document)
		.values({
			hash: 'd'.repeat(64),
			mime: 'message/rfc822',
			size: 256,
			originalName: 'late-approval.eml',
			provenance: 'mail' as const,
			contractId,
			confidential: true,
			ownerType: 'contract' as const,
			ownerId: contractId
		})
		.returning();
	const [approvalRow] = await tx
		.insert(approval)
		.values({
			contractId,
			channel: 'email' as const,
			sender: 'client@example.com',
			receivedAt: new Date('2024-06-05T09:00:00Z'),
			messageId: '<late@example.com>',
			documentId: documentRow.id,
			excerpt: 'Sorry for the delay, yes, that day is fine.',
			origin: { kind: 'manual' } satisfies ApprovalOrigin
		})
		.returning();
	return approvalRow;
}

function workUnitFields(contractId: string, overrides: Partial<typeof workUnit.$inferInsert> = {}) {
	return {
		contractId,
		date: '2024-06-03',
		quantity: 1,
		scope: 'Fixed the production incident.',
		state: 'worked' as const,
		...overrides
	};
}

test('a worked day with no approval on a contract that requires one lands in worked_without_approval automatically, with no extra action', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx, true);

			const [row] = await tx.insert(workUnit).values(workUnitFields(contractRow.id)).returning();

			expect(row.state).toBe('worked_without_approval');
			expect(row.approvalId).toBeNull();

			tx.rollback();
		})
	).rejects.toThrow();
});

test('the same recording on a contract that does not require approval stays a plain worked day', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx, false);

			const [row] = await tx.insert(workUnit).values(workUnitFields(contractRow.id)).returning();

			expect(row.state).toBe('worked');

			tx.rollback();
		})
	).rejects.toThrow();
});

test('recording worked with an approval already linked never touches the risk state', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx, true);
			const approvalRow = await insertApproval(tx, contractRow.id);

			const [row] = await tx
				.insert(workUnit)
				.values(workUnitFields(contractRow.id, { approvalId: approvalRow.id }))
				.returning();

			expect(row.state).toBe('worked');

			tx.rollback();
		})
	).rejects.toThrow();
});

test('transitioning an approved day to worked also redirects it if the approval is missing', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx, false);
			// requires_prior_approval is false here so 'approved' with no
			// approval_id is legal (#21); once the contract is edited to
			// require approval later, a day already mid-flight without one
			// still gets caught the moment it is recorded worked.
			const [row] = await tx
				.insert(workUnit)
				.values(workUnitFields(contractRow.id, { state: 'proposed' }))
				.returning();
			await tx.update(workUnit).set({ state: 'approved' }).where(eq(workUnit.id, row.id));
			await tx
				.update(contract)
				.set({ requiresPriorApproval: true })
				.where(eq(contract.id, contractRow.id));

			const [updated] = await tx
				.update(workUnit)
				.set({ state: 'worked' })
				.where(eq(workUnit.id, row.id))
				.returning();

			expect(updated.state).toBe('worked_without_approval');

			tx.rollback();
		})
	).rejects.toThrow();
});

test('the risk state is never silently corrected or hidden: claiming worked without a real approval leaves it exactly where it was', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx, true);
			const [row] = await tx.insert(workUnit).values(workUnitFields(contractRow.id)).returning();
			expect(row.state).toBe('worked_without_approval');

			// No repository call papers over this: setting `state: 'worked'`
			// straight through drizzle, with no approval_id, is exactly what a
			// careless write would try. The trigger redirects it right back.
			const [stillAtRisk] = await tx
				.update(workUnit)
				.set({ state: 'worked' })
				.where(eq(workUnit.id, row.id))
				.returning();

			expect(stillAtRisk.state).toBe('worked_without_approval');
			expect(stillAtRisk.approvalId).toBeNull();

			tx.rollback();
		})
	).rejects.toThrow();
});

test('the risk state is a queryable, timestamped event #74 can poll: the log shows it the same day', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx, true);
			const before = new Date();
			const [row] = await tx.insert(workUnit).values(workUnitFields(contractRow.id)).returning();

			const [entry] = await tx
				.select()
				.from(workUnitTransition)
				.where(eq(workUnitTransition.workUnitId, row.id));

			expect(entry.toState).toBe('worked_without_approval');
			expect(entry.fromState).toBeNull();
			expect(entry.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
			expect(entry.createdAt.toDateString()).toBe(new Date().toDateString());

			tx.rollback();
		})
	).rejects.toThrow();
});

test('linking a late approval moves the day to worked, and the log still shows it passed through the risk state', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx, true);
			const [row] = await tx.insert(workUnit).values(workUnitFields(contractRow.id)).returning();
			expect(row.state).toBe('worked_without_approval');

			const approvalRow = await insertApproval(tx, contractRow.id);
			const [recovered] = await tx
				.update(workUnit)
				.set({ approvalId: approvalRow.id })
				.where(eq(workUnit.id, row.id))
				.returning();

			expect(recovered.state).toBe('worked');
			expect(recovered.approvalId).toBe(approvalRow.id);

			const log = await tx
				.select()
				.from(workUnitTransition)
				.where(eq(workUnitTransition.workUnitId, row.id))
				.orderBy(workUnitTransition.createdAt);

			expect(log.map((entry) => [entry.fromState, entry.toState])).toEqual([
				[null, 'worked_without_approval'],
				['worked_without_approval', 'worked']
			]);

			tx.rollback();
		})
	).rejects.toThrow();
});

test('a day can also be recorded unbillable when no approval ever arrives', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx, true);
			const [row] = await tx.insert(workUnit).values(workUnitFields(contractRow.id)).returning();

			const [updated] = await tx
				.update(workUnit)
				.set({ state: 'unbillable' })
				.where(eq(workUnit.id, row.id))
				.returning();

			expect(updated.state).toBe('unbillable');

			tx.rollback();
		})
	).rejects.toThrow();
});
