import { eq, sql } from 'drizzle-orm';
import { afterAll, expect, test } from 'vitest';
import { client as pool, db } from '$lib/server/db';
import { approval, client, contract, document, workUnit, workUnitTransition } from './index';
import type { ApprovalOrigin } from './approval';
import type { ExpensePolicy, PaymentTerms } from './contract';

// Needs a migrated database: `pnpm db:up && pnpm db:migrate`.
// Real database, work done inside a transaction that is always rolled back —
// see `src/lib/server/db/set-updated-at.test.ts` for the pattern. These
// exercise `0012_work_unit_state_machine.sql`, the database-level half of
// #21's acceptance. `worked_without_approval.test.ts` in this folder covers
// #23's automatic entry into the risk state and recovery from it.

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
			hash: 'c'.repeat(64),
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
	const [approvalRow] = await tx
		.insert(approval)
		.values({
			contractId,
			channel: 'email' as const,
			sender: 'client@example.com',
			receivedAt: new Date('2024-05-01T09:00:00Z'),
			messageId: '<abc@example.com>',
			documentId: documentRow.id,
			excerpt: 'Yes, go ahead.',
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
		scope: 'Implemented the reporting module.',
		...overrides
	};
}

test('a well-formed proposed work_unit is accepted', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx, false);
			const [row] = await tx.insert(workUnit).values(workUnitFields(contractRow.id)).returning();
			expect(row.state).toBe('proposed');

			tx.rollback();
		})
	).rejects.toThrow();
});

test('a non-positive quantity is rejected by the database', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx, false);

			await expect(
				tx.insert(workUnit).values(workUnitFields(contractRow.id, { quantity: 0 }))
			).rejects.toMatchObject({ code: '23514', constraint_name: 'work_unit_quantity_positive' });

			tx.rollback();
		})
	).rejects.toThrow();
});

test('inserting directly into approved is rejected by the database', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx, false);

			await expect(
				tx.insert(workUnit).values(workUnitFields(contractRow.id, { state: 'approved' }))
			).rejects.toThrow(/cannot be inserted directly into state/);

			tx.rollback();
		})
	).rejects.toThrow();
});

test('approving a day on a contract that requires prior approval without an approval_id fails at the database level', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx, true);
			const [row] = await tx.insert(workUnit).values(workUnitFields(contractRow.id)).returning();

			await expect(
				tx.update(workUnit).set({ state: 'approved' }).where(eq(workUnit.id, row.id))
			).rejects.toThrow(/requires prior approval needs an approval_id/);

			tx.rollback();
		})
	).rejects.toThrow();
});

test('approving a day on a contract that requires prior approval with an approval_id succeeds', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx, true);
			const approvalRow = await insertApproval(tx, contractRow.id);
			const [row] = await tx.insert(workUnit).values(workUnitFields(contractRow.id)).returning();

			const [updated] = await tx
				.update(workUnit)
				.set({ state: 'approved', approvalId: approvalRow.id })
				.where(eq(workUnit.id, row.id))
				.returning();
			expect(updated.state).toBe('approved');

			tx.rollback();
		})
	).rejects.toThrow();
});

test('a contract that does not require prior approval can reach approved with no approval_id', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx, false);
			const [row] = await tx.insert(workUnit).values(workUnitFields(contractRow.id)).returning();

			const [updated] = await tx
				.update(workUnit)
				.set({ state: 'approved' })
				.where(eq(workUnit.id, row.id))
				.returning();
			expect(updated.state).toBe('approved');

			tx.rollback();
		})
	).rejects.toThrow();
});

test('an illegal transition, paid straight from proposed, is rejected', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx, false);
			const [row] = await tx.insert(workUnit).values(workUnitFields(contractRow.id)).returning();

			await expect(
				tx
					.update(workUnit)
					.set({ state: 'paid', invoiceLineId: crypto.randomUUID() })
					.where(eq(workUnit.id, row.id))
			).rejects.toThrow(/illegal work_unit transition: proposed -> paid/);

			tx.rollback();
		})
	).rejects.toThrow();
});

test('reaching invoiced or paid without an invoice_line_id is rejected by the database', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx, false);
			const [row] = await tx
				.insert(workUnit)
				.values(workUnitFields(contractRow.id, { state: 'worked' }))
				.returning();

			await expect(
				tx.update(workUnit).set({ state: 'invoiced' }).where(eq(workUnit.id, row.id))
			).rejects.toMatchObject({
				code: '23514',
				constraint_name: 'work_unit_invoiced_or_paid_has_invoice_line'
			});

			tx.rollback();
		})
	).rejects.toThrow();
});

test('a full legal lifecycle is logged end to end, with actor and reason', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx, true);
			const approvalRow = await insertApproval(tx, contractRow.id);

			await tx.execute(
				sql`select set_config('mastro.actor', '{"kind":"human","email":"lorenzo@example.com"}', true)`
			);
			await tx.execute(sql`select set_config('mastro.reason', 'client confirmed the days', true)`);

			const [row] = await tx.insert(workUnit).values(workUnitFields(contractRow.id)).returning();
			await tx
				.update(workUnit)
				.set({ state: 'approved', approvalId: approvalRow.id })
				.where(eq(workUnit.id, row.id));
			await tx.update(workUnit).set({ state: 'worked' }).where(eq(workUnit.id, row.id));
			await tx
				.update(workUnit)
				.set({ state: 'invoiced', invoiceLineId: crypto.randomUUID() })
				.where(eq(workUnit.id, row.id));

			const log = await tx
				.select()
				.from(workUnitTransition)
				.where(eq(workUnitTransition.workUnitId, row.id))
				.orderBy(workUnitTransition.createdAt);

			expect(log.map((t) => [t.fromState, t.toState])).toEqual([
				[null, 'proposed'],
				['proposed', 'approved'],
				['approved', 'worked'],
				['worked', 'invoiced']
			]);
			for (const entry of log) {
				expect(entry.actor).toEqual({ kind: 'human', email: 'lorenzo@example.com' });
				expect(entry.reason).toBe('client confirmed the days');
			}

			tx.rollback();
		})
	).rejects.toThrow();
});

test('an update that does not change state is not logged as a transition', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx, false);
			const [row] = await tx.insert(workUnit).values(workUnitFields(contractRow.id)).returning();

			await tx.update(workUnit).set({ notes: 'edited later' }).where(eq(workUnit.id, row.id));

			const log = await tx
				.select()
				.from(workUnitTransition)
				.where(eq(workUnitTransition.workUnitId, row.id));
			expect(log).toHaveLength(1);
			expect(log[0].toState).toBe('proposed');

			tx.rollback();
		})
	).rejects.toThrow();
});

test('a write outside the repository still gets logged, with a system actor and a generic reason', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx, false);
			const [row] = await tx.insert(workUnit).values(workUnitFields(contractRow.id)).returning();

			const log = await tx
				.select()
				.from(workUnitTransition)
				.where(eq(workUnitTransition.workUnitId, row.id));
			expect(log).toHaveLength(1);
			expect(log[0].actor).toEqual({ kind: 'system' });
			expect(log[0].reason).toBe('no reason supplied');

			tx.rollback();
		})
	).rejects.toThrow();
});

test('the transition log cannot be updated', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx, false);
			const [row] = await tx.insert(workUnit).values(workUnitFields(contractRow.id)).returning();
			const [entry] = await tx
				.select()
				.from(workUnitTransition)
				.where(eq(workUnitTransition.workUnitId, row.id));

			await expect(
				tx
					.update(workUnitTransition)
					.set({ reason: 'a different story' })
					.where(eq(workUnitTransition.id, entry.id))
			).rejects.toThrow(/immutable once written/);

			tx.rollback();
		})
	).rejects.toThrow();
});

test('the transition log cannot be deleted', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx, false);
			const [row] = await tx.insert(workUnit).values(workUnitFields(contractRow.id)).returning();
			const [entry] = await tx
				.select()
				.from(workUnitTransition)
				.where(eq(workUnitTransition.workUnitId, row.id));

			await expect(
				tx.delete(workUnitTransition).where(eq(workUnitTransition.id, entry.id))
			).rejects.toThrow(/immutable once written/);

			tx.rollback();
		})
	).rejects.toThrow();
});

test('only one active work_unit per contract per date is allowed', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx, false);
			await tx.insert(workUnit).values(workUnitFields(contractRow.id));

			await expect(
				tx.insert(workUnit).values(workUnitFields(contractRow.id))
			).rejects.toMatchObject({
				code: '23505',
				constraint_name: 'work_unit_one_active_per_contract_date'
			});

			tx.rollback();
		})
	).rejects.toThrow();
});

test('a rejected day does not block a new proposal for the same contract and date', async () => {
	await expect(
		db.transaction(async (tx) => {
			const contractRow = await insertContract(tx, false);
			const [first] = await tx.insert(workUnit).values(workUnitFields(contractRow.id)).returning();
			await tx.update(workUnit).set({ state: 'rejected' }).where(eq(workUnit.id, first.id));

			const [second] = await tx.insert(workUnit).values(workUnitFields(contractRow.id)).returning();
			expect(second.id).not.toBe(first.id);

			tx.rollback();
		})
	).rejects.toThrow();
});
