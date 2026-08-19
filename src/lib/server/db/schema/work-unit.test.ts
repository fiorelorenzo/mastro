import { eq, sql } from 'drizzle-orm';
import { afterAll, expect, test } from 'vitest';
import { minorUnits } from '$lib/money';
import { rejection } from '$lib/server/db/pg-error';
import { inRolledBackTransaction } from '$lib/server/db/rollback';
import { client as pool, db, type DbExecutor } from '$lib/server/db';
import {
	approval,
	client,
	contract,
	document,
	invoice,
	invoiceLine,
	workUnit,
	workUnitTransition
} from './index';
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

/** A real `invoice_line` for a day to be billed onto: `work_unit.invoice_line_id`
 * has been a foreign key since #26, so the uuid this file used to invent was
 * never going to satisfy it. */
async function insertInvoiceLine(tx: DbExecutor, contractId: string) {
	const [invoiceRow] = await tx
		.insert(invoice)
		.values({
			contractId,
			number: `LC-${crypto.randomUUID().slice(0, 8)}`,
			issueDate: '2026-02-28',
			currency: 'EUR',
			taxableAmount: minorUnits(100_000),
			taxAmount: minorUnits(22_000),
			total: minorUnits(122_000),
			dueDate: '2026-03-30',
			dueDateSource: 'computed'
		})
		.returning();
	const [lineRow] = await tx
		.insert(invoiceLine)
		.values({
			invoiceId: invoiceRow.id,
			description: 'Days',
			quantity: 1,
			unitPrice: minorUnits(100_000),
			amount: minorUnits(100_000),
			taxRate: 22
		})
		.returning();
	return lineRow;
}

test('a well-formed proposed work_unit is accepted', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx, false);
		const [row] = await tx.insert(workUnit).values(workUnitFields(contractRow.id)).returning();
		expect(row.state).toBe('proposed');
	});
});

test('a non-positive quantity is rejected by the database', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx, false);

		expect(
			await rejection(() =>
				tx.insert(workUnit).values(workUnitFields(contractRow.id, { quantity: 0 }))
			)
		).toMatchObject({ code: '23514', constraint_name: 'work_unit_quantity_positive' });
	});
});

test('inserting directly into approved is rejected by the database', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx, false);

		expect(
			await rejection(() =>
				tx.insert(workUnit).values(workUnitFields(contractRow.id, { state: 'approved' }))
			)
		).toMatchObject({
			code: 'P0001',
			message: expect.stringMatching(/cannot be inserted directly into state/)
		});
	});
});

test('approving a day on a contract that requires prior approval without an approval_id fails at the database level', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx, true);
		const [row] = await tx.insert(workUnit).values(workUnitFields(contractRow.id)).returning();

		expect(
			await rejection(() =>
				tx.update(workUnit).set({ state: 'approved' }).where(eq(workUnit.id, row.id))
			)
		).toMatchObject({
			code: 'P0001',
			message: expect.stringMatching(/requires prior approval needs an approval_id/)
		});
	});
});

test('approving a day on a contract that requires prior approval with an approval_id succeeds', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx, true);
		const approvalRow = await insertApproval(tx, contractRow.id);
		const [row] = await tx.insert(workUnit).values(workUnitFields(contractRow.id)).returning();

		const [updated] = await tx
			.update(workUnit)
			.set({ state: 'approved', approvalId: approvalRow.id })
			.where(eq(workUnit.id, row.id))
			.returning();
		expect(updated.state).toBe('approved');
	});
});

test('a contract that does not require prior approval can reach approved with no approval_id', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx, false);
		const [row] = await tx.insert(workUnit).values(workUnitFields(contractRow.id)).returning();

		const [updated] = await tx
			.update(workUnit)
			.set({ state: 'approved' })
			.where(eq(workUnit.id, row.id))
			.returning();
		expect(updated.state).toBe('approved');
	});
});

test('an illegal transition, paid straight from proposed, is rejected', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx, false);
		const [row] = await tx.insert(workUnit).values(workUnitFields(contractRow.id)).returning();

		expect(
			await rejection(() =>
				tx
					.update(workUnit)
					.set({ state: 'paid', invoiceLineId: crypto.randomUUID() })
					.where(eq(workUnit.id, row.id))
			)
		).toMatchObject({
			code: 'P0001',
			message: expect.stringMatching(/illegal work_unit transition: proposed -> paid/)
		});
	});
});

test('reaching invoiced or paid without an invoice_line_id is rejected by the database', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx, false);
		const [row] = await tx
			.insert(workUnit)
			.values(workUnitFields(contractRow.id, { state: 'worked' }))
			.returning();

		expect(
			await rejection(() =>
				tx.update(workUnit).set({ state: 'invoiced' }).where(eq(workUnit.id, row.id))
			)
		).toMatchObject({
			code: '23514',
			constraint_name: 'work_unit_invoiced_or_paid_has_invoice_line'
		});
	});
});

test('a full legal lifecycle is logged end to end, with actor and reason', async () => {
	await inRolledBackTransaction(async (tx) => {
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
			.set({ state: 'invoiced', invoiceLineId: (await insertInvoiceLine(tx, contractRow.id)).id })
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
	});
});

test('an update that does not change state is not logged as a transition', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx, false);
		const [row] = await tx.insert(workUnit).values(workUnitFields(contractRow.id)).returning();

		await tx.update(workUnit).set({ notes: 'edited later' }).where(eq(workUnit.id, row.id));

		const log = await tx
			.select()
			.from(workUnitTransition)
			.where(eq(workUnitTransition.workUnitId, row.id));
		expect(log).toHaveLength(1);
		expect(log[0].toState).toBe('proposed');
	});
});

test('a write outside the repository still gets logged, with a system actor and a generic reason', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx, false);
		const [row] = await tx.insert(workUnit).values(workUnitFields(contractRow.id)).returning();

		const log = await tx
			.select()
			.from(workUnitTransition)
			.where(eq(workUnitTransition.workUnitId, row.id));
		expect(log).toHaveLength(1);
		expect(log[0].actor).toEqual({ kind: 'system' });
		expect(log[0].reason).toBe('no reason supplied');
	});
});

test('the transition log cannot be updated', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx, false);
		const [row] = await tx.insert(workUnit).values(workUnitFields(contractRow.id)).returning();
		const [entry] = await tx
			.select()
			.from(workUnitTransition)
			.where(eq(workUnitTransition.workUnitId, row.id));

		expect(
			(
				await rejection(() =>
					tx
						.update(workUnitTransition)
						.set({ reason: 'a different story' })
						.where(eq(workUnitTransition.id, entry.id))
				)
			).message
		).toMatch(/immutable once written/);
	});
});

test('the transition log cannot be deleted', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx, false);
		const [row] = await tx.insert(workUnit).values(workUnitFields(contractRow.id)).returning();
		const [entry] = await tx
			.select()
			.from(workUnitTransition)
			.where(eq(workUnitTransition.workUnitId, row.id));

		expect(
			(
				await rejection(() =>
					tx.delete(workUnitTransition).where(eq(workUnitTransition.id, entry.id))
				)
			).message
		).toMatch(/immutable once written/);
	});
});

test('only one active work_unit per contract per date is allowed', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx, false);
		await tx.insert(workUnit).values(workUnitFields(contractRow.id));

		expect(
			await rejection(() => tx.insert(workUnit).values(workUnitFields(contractRow.id)))
		).toMatchObject({
			code: '23505',
			constraint_name: 'work_unit_one_active_per_contract_date'
		});
	});
});

test('a rejected day does not block a new proposal for the same contract and date', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx, false);
		const [first] = await tx.insert(workUnit).values(workUnitFields(contractRow.id)).returning();
		await tx.update(workUnit).set({ state: 'rejected' }).where(eq(workUnit.id, first.id));

		const [second] = await tx.insert(workUnit).values(workUnitFields(contractRow.id)).returning();
		expect(second.id).not.toBe(first.id);
	});
});

test('proposed to rejected is accepted', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx, false);
		const [row] = await tx.insert(workUnit).values(workUnitFields(contractRow.id)).returning();

		const [updated] = await tx
			.update(workUnit)
			.set({ state: 'rejected' })
			.where(eq(workUnit.id, row.id))
			.returning();
		expect(updated.state).toBe('rejected');
	});
});

test('rejected is a dead end: neither approved nor worked is reachable from it', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx, false);
		const [row] = await tx.insert(workUnit).values(workUnitFields(contractRow.id)).returning();
		await tx.update(workUnit).set({ state: 'rejected' }).where(eq(workUnit.id, row.id));

		// Two rejections on the same row, in the same test: each needs its
		// own savepoint (`rejection(fn, tx)`), since the first failed
		// statement would otherwise abort the whole transaction and turn
		// the second attempt into "current transaction is aborted" instead
		// of the illegal-transition error it is supposed to prove.
		expect(
			await rejection(
				() => tx.update(workUnit).set({ state: 'approved' }).where(eq(workUnit.id, row.id)),
				tx
			)
		).toMatchObject({
			code: 'P0001',
			message: expect.stringMatching(/illegal work_unit transition: rejected -> approved/)
		});

		expect(
			await rejection(
				() => tx.update(workUnit).set({ state: 'worked' }).where(eq(workUnit.id, row.id)),
				tx
			)
		).toMatchObject({
			code: 'P0001',
			message: expect.stringMatching(/illegal work_unit transition: rejected -> worked/)
		});

		const [stillRejected] = await tx.select().from(workUnit).where(eq(workUnit.id, row.id));
		expect(stillRejected.state).toBe('rejected');
	});
});

test('proposed to revoked is rejected: revoked is only reachable from approved', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx, false);
		const [row] = await tx.insert(workUnit).values(workUnitFields(contractRow.id)).returning();

		expect(
			await rejection(() =>
				tx.update(workUnit).set({ state: 'revoked' }).where(eq(workUnit.id, row.id))
			)
		).toMatchObject({
			code: 'P0001',
			message: expect.stringMatching(/illegal work_unit transition: proposed -> revoked/)
		});
	});
});

test('approved to revoked is accepted', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx, false);
		const [row] = await tx.insert(workUnit).values(workUnitFields(contractRow.id)).returning();
		await tx.update(workUnit).set({ state: 'approved' }).where(eq(workUnit.id, row.id));

		const [updated] = await tx
			.update(workUnit)
			.set({ state: 'revoked' })
			.where(eq(workUnit.id, row.id))
			.returning();
		expect(updated.state).toBe('revoked');
	});
});

test('worked to disputed is rejected: disputed is only reachable from invoiced', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx, false);
		const [row] = await tx
			.insert(workUnit)
			.values(workUnitFields(contractRow.id, { state: 'worked' }))
			.returning();

		expect(
			await rejection(() =>
				tx.update(workUnit).set({ state: 'disputed' }).where(eq(workUnit.id, row.id))
			)
		).toMatchObject({
			code: 'P0001',
			message: expect.stringMatching(/illegal work_unit transition: worked -> disputed/)
		});
	});
});

test('invoiced to paid is accepted', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx, false);
		const lineRow = await insertInvoiceLine(tx, contractRow.id);
		const [row] = await tx
			.insert(workUnit)
			.values(workUnitFields(contractRow.id, { state: 'worked' }))
			.returning();
		await tx
			.update(workUnit)
			.set({ state: 'invoiced', invoiceLineId: lineRow.id })
			.where(eq(workUnit.id, row.id));

		const [paid] = await tx
			.update(workUnit)
			.set({ state: 'paid' })
			.where(eq(workUnit.id, row.id))
			.returning();
		expect(paid.state).toBe('paid');
	});
});

test('invoiced and disputed cycle back and forth: a dispute can be re-invoiced and disputed again', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx, false);
		const lineRow = await insertInvoiceLine(tx, contractRow.id);
		const [row] = await tx
			.insert(workUnit)
			.values(workUnitFields(contractRow.id, { state: 'worked' }))
			.returning();

		await tx
			.update(workUnit)
			.set({ state: 'invoiced', invoiceLineId: lineRow.id })
			.where(eq(workUnit.id, row.id));
		await tx.update(workUnit).set({ state: 'disputed' }).where(eq(workUnit.id, row.id));
		await tx.update(workUnit).set({ state: 'invoiced' }).where(eq(workUnit.id, row.id));
		const [final] = await tx
			.update(workUnit)
			.set({ state: 'disputed' })
			.where(eq(workUnit.id, row.id))
			.returning();

		expect(final.state).toBe('disputed');

		const log = await tx
			.select()
			.from(workUnitTransition)
			.where(eq(workUnitTransition.workUnitId, row.id))
			.orderBy(workUnitTransition.createdAt);
		expect(log.map((entry) => [entry.fromState, entry.toState])).toEqual([
			[null, 'worked'],
			['worked', 'invoiced'],
			['invoiced', 'disputed'],
			['disputed', 'invoiced'],
			['invoiced', 'disputed']
		]);
	});
});

test('approving with an approval_id that does not exist is rejected by the foreign key, not silently accepted', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx, true);
		const [row] = await tx.insert(workUnit).values(workUnitFields(contractRow.id)).returning();

		expect(
			await rejection(() =>
				tx
					.update(workUnit)
					.set({ state: 'approved', approvalId: crypto.randomUUID() })
					.where(eq(workUnit.id, row.id))
			)
		).toMatchObject({ code: '23503', constraint_name: 'work_unit_approval_id_approval_id_fk' });
	});
});

test('a fabricated approval_id does not trigger the worked_without_approval redirect, but the foreign key still rejects it', async () => {
	await inRolledBackTransaction(async (tx) => {
		const contractRow = await insertContract(tx, true);

		// The redirect in 0013_worked_without_approval.sql only fires when
		// approval_id IS NULL, so a non-null value that points at nothing
		// skips the redirect and reaches the foreign key instead — it must
		// not be mistaken for a real approval on the way.
		expect(
			await rejection(() =>
				tx
					.insert(workUnit)
					.values(
						workUnitFields(contractRow.id, { state: 'worked', approvalId: crypto.randomUUID() })
					)
			)
		).toMatchObject({ code: '23503', constraint_name: 'work_unit_approval_id_approval_id_fk' });
	});
});
